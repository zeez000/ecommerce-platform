# Event-Driven E-Commerce Microservices Platform

A hands-on DevOps and distributed-systems project built with **Node.js, Express, MongoDB, Redis, Apache Kafka, Docker, GitHub Actions, Kubernetes, Prometheus, and Grafana**.

This README is written as both:

1. a guide for anyone who wants to run the project
2. a study/reference document explaining how every major part works

---

# 1. What this project does

This project simulates the backend of an e-commerce system using independent microservices.

It currently has four main application services:

- **API Gateway**
- **Product Service**
- **Inventory Service**
- **Order Service**

Supporting infrastructure:

- **MongoDB** for persistence
- **Redis** for caching
- **Kafka** for asynchronous event-driven communication
- **Docker Compose** for local orchestration
- **GitHub Actions** for CI
- **Kubernetes** for orchestration
- **Prometheus + Grafana** for monitoring

The main business flow is:

```text
Create Product
     |
     v
Product Service
     |
     | product.created
     v
Kafka
     |
     v
Inventory Service
     |
     v
Inventory record created
```

Then:

```text
Create Order
     |
     v
Order Service
     |
     | order.created
     v
Kafka
     |
     v
Inventory Service
     |
     +---- enough stock ----> reserve stock
     |                          |
     |                          | inventory.reserved
     |                          v
     |                       Kafka
     |                          |
     |                          v
     |                     Order Service
     |                          |
     |                          v
     |                      confirmed
     |
     +---- not enough ------> inventory.rejected
                                |
                                v
                           Order Service
                                |
                                v
                            rejected
```

---

# 2. High-level architecture

```text
                         Client
                           |
                           v
                    API Gateway :8080
                  /        |         \
                 /         |          \
                v          v           v
      Product Service  Inventory Service  Order Service
          :3000             :3001            :3002
             |                 |                |
             |                 |                |
             +-------------- MongoDB -----------+
             |
             v
           Redis

                    Kafka :9092
            /           |           \
           /            |            \
 product-events    order-events    inventory-events
```

The API Gateway handles incoming HTTP traffic.

The services communicate in two ways:

- **REST APIs** for synchronous requests
- **Kafka events** for asynchronous workflows

---

# 3. Repository structure

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── publish-images.yml
│
├── api-gateway/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
│
├── product-service/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
│
├── inventory-service/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
│
├── order-service/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
│
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── mongodb.yaml
│   ├── redis.yaml
│   ├── kafka.yaml
│   ├── apps.yaml
│   ├── ingress.yaml
│   └── kustomization.yaml
│
├── monitoring/
│   └── prometheus.yml
│
├── scripts/
│   └── smoke-test.sh
│
├── docker-compose.yml
├── docker-compose.monitoring.yml
├── .env.example
└── README.md
```

---

# 4. What each service does

## API Gateway

Folder:

```text
api-gateway/
```

Purpose:

The API Gateway is the single entry point for clients.

Instead of directly calling different ports, clients can send requests through:

```text
http://localhost:8080
```

Routes:

```text
/products   -> Product Service
/inventory  -> Inventory Service
/orders     -> Order Service
```

Example:

```text
Client
   |
   v
localhost:8080/products/products
   |
   v
API Gateway
   |
   v
product-service:3000/products
```

This simulates the gateway pattern commonly used in microservice architectures.

---

## Product Service

Folder:

```text
product-service/
```

Port:

```text
3000
```

Responsibilities:

- create products
- list products
- get individual products
- update products
- delete products
- store product data in MongoDB
- cache product lists in Redis
- publish `product.created` events to Kafka

Product example:

```json
{
  "name": "Mechanical Keyboard",
  "price": 2499
}
```

When a product is created:

```text
Product Service
     |
     v
MongoDB save
     |
     v
Kafka
     |
     v
topic: product-events
     |
     v
event: product.created
```

Redis is used when reading the product list.

First request:

```text
GET /products
    |
    v
Redis cache miss
    |
    v
MongoDB
    |
    v
Store result in Redis
```

Next request:

```text
GET /products
    |
    v
Redis cache hit
    |
    v
Return cached response
```

Whenever products are created, updated, or deleted, the cached product list is invalidated.

---

# 5. Inventory Service

Folder:

```text
inventory-service/
```

Port:

```text
3001
```

Responsibilities:

- create inventory records from product events
- track available stock
- update stock manually
- consume order events
- reserve stock
- publish reservation or rejection results

The Inventory Service consumes:

```text
product-events
order-events
```

and publishes:

```text
inventory-events
```

## Product inventory creation

When Product Service publishes:

```json
{
  "event": "product.created",
  "productId": "...",
  "name": "Mechanical Keyboard",
  "price": 2499
}
```

Inventory Service automatically creates:

```json
{
  "productId": "...",
  "productName": "Mechanical Keyboard",
  "quantity": 0
}
```

This means product creation and inventory creation are loosely coupled.

Product Service does not directly call Inventory Service.

Kafka connects them.

---

# 6. Order Service

Folder:

```text
order-service/
```

Port:

```text
3002
```

Responsibilities:

- create orders
- store orders in MongoDB
- publish `order.created`
- consume inventory responses
- confirm or reject orders

Order example:

```json
{
  "productId": "...",
  "quantity": 2
}
```

Initially:

```text
status = pending
```

Then Inventory Service processes the order.

Possible final states:

```text
pending
confirmed
rejected
```

---

# 7. Why orderId is important

Every order gets its own unique ID.

That ID is passed through the full Kafka workflow.

Example:

```text
Order Service
     |
     | order.created
     | orderId = 123
     v
Kafka
     |
     v
Inventory Service
     |
     | inventory.reserved
     | orderId = 123
     v
Kafka
     |
     v
Order Service
     |
     v
Update order 123 only
```

Without this correlation ID, two pending orders for the same product could accidentally update the wrong order.

---

# 8. Atomic stock reservation

A normal but unsafe stock flow could be:

```text
read quantity
check quantity
subtract quantity
save
```

Two requests running at the same time could both read the same stock value.

This project instead uses a conditional MongoDB update.

Conceptually:

```text
IF quantity >= requested amount
THEN quantity = quantity - requested amount
```

This reduces the risk of overselling.

---

# 9. MongoDB

MongoDB stores persistent application data.

Collections are created by Mongoose.

Main data includes:

```text
products
inventories
orders
```

Docker Compose connection string:

```text
mongodb://mongodb:27017/ecommerce
```

Inside Docker, services use the Compose service name:

```text
mongodb
```

instead of:

```text
localhost
```

because each container runs in its own network namespace.

---

# 10. Redis

Redis is currently used by the Product Service.

Purpose:

```text
speed up repeated product-list reads
```

Connection:

```text
redis://redis:6379
```

Cache key:

```text
products
```

Default TTL:

```text
60 seconds
```

---

# 11. Apache Kafka

Kafka handles asynchronous communication.

Broker:

```text
kafka:9092
```

Kafka is running in **KRaft mode**, meaning ZooKeeper is not required.

Current topics:

```text
product-events
order-events
inventory-events
```

Event flow:

```text
Product Service
     |
     v
product-events
     |
     v
Inventory Service
```

```text
Order Service
     |
     v
order-events
     |
     v
Inventory Service
```

```text
Inventory Service
     |
     v
inventory-events
     |
     v
Order Service
```

---

# 12. Docker

Every application service has its own Dockerfile.

Example lifecycle:

```text
source code
   |
   v
Dockerfile
   |
   v
Docker image
   |
   v
Docker container
```

The Dockerfiles:

- use Node Alpine images
- copy package files
- install dependencies
- copy source code
- expose the service port
- start `server.js`

---

# 13. Docker Compose

Main file:

```text
docker-compose.yml
```

It runs:

```text
MongoDB
Redis
Kafka
Product Service
Inventory Service
Order Service
API Gateway
```

All containers share the Docker Compose network.

That is why service names can be used as DNS names.

Example:

```text
http://product-service:3000
```

Health checks are included so dependent services do not start blindly.

---

# 14. Run the project locally

Requirements:

- Docker Desktop or Docker Engine
- Docker Compose plugin
- Git

Clone:

```bash
git clone https://github.com/zeez000/ecommerce-platform.git
cd ecommerce-platform
```

If using the development branch:

```bash
git checkout devops-completion
```

Start everything:

```bash
docker compose up --build -d
```

Check status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

View one service:

```bash
docker compose logs -f product-service
```

Stop:

```bash
docker compose down
```

Stop and delete stored MongoDB data:

```bash
docker compose down -v
```

---

# 15. Check service health

API Gateway:

```bash
curl http://localhost:8080/health
```

Product Service:

```bash
curl http://localhost:3000/health
```

Inventory Service:

```bash
curl http://localhost:3001/health
```

Order Service:

```bash
curl http://localhost:3002/health
```

Expected style of response:

```json
{
  "service": "product-service",
  "status": "healthy",
  "uptime": 120,
  "timestamp": "..."
}
```

---

# 16. Full manual test flow

## Step 1 - Create product

```bash
curl -X POST http://localhost:8080/products/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Keyboard","price":2499}'
```

Copy the returned:

```text
_id
```

That is the product ID.

---

## Step 2 - Check inventory

Wait a moment for Kafka.

Then:

```bash
curl http://localhost:8080/inventory/inventory
```

You should see an inventory record automatically created for that product.

Initial stock:

```text
0
```

---

## Step 3 - Add stock

Replace `PRODUCT_ID`:

```bash
curl -X PUT http://localhost:8080/inventory/inventory/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{"quantity":10}'
```

---

## Step 4 - Create order

```bash
curl -X POST http://localhost:8080/orders/orders \
  -H "Content-Type: application/json" \
  -d '{"productId":"PRODUCT_ID","quantity":2}'
```

Copy the returned order ID.

Initially:

```text
status: pending
```

---

## Step 5 - Check order again

```bash
curl http://localhost:8080/orders/orders/ORDER_ID
```

After Kafka processing:

```text
status: confirmed
```

Stock should now be:

```text
8
```

---

# 17. Automatic smoke test

Instead of manually doing all of the above:

```bash
bash scripts/smoke-test.sh
```

The script automatically:

1. checks API Gateway health
2. creates a product
3. waits for Inventory Service to consume the Kafka event
4. checks the inventory record exists
5. adds stock
6. creates an order
7. waits for inventory reservation
8. checks the correct order becomes confirmed
9. checks stock was reduced correctly

Success message:

```text
Smoke test passed:
product -> inventory -> order -> reservation -> confirmation
```

---

# 18. GitHub Actions CI

Workflow:

```text
.github/workflows/ci.yml
```

Triggered on:

```text
push
pull request
```

Current CI flow:

```text
Git Push
   |
   v
GitHub Actions
   |
   v
Install dependencies
   |
   v
Validate Docker Compose
   |
   v
Build images
   |
   v
Start entire stack
   |
   v
Wait for healthy API Gateway
   |
   v
Run smoke test
   |
   v
Success / Failure
```

If something fails, the workflow prints container logs for debugging.

---

# 19. GHCR container publishing

Workflow:

```text
.github/workflows/publish-images.yml
```

On pushes to `main`, application Docker images are built and pushed to GitHub Container Registry.

Images:

```text
ghcr.io/zeez000/ecommerce-api-gateway
ghcr.io/zeez000/ecommerce-product-service
ghcr.io/zeez000/ecommerce-inventory-service
ghcr.io/zeez000/ecommerce-order-service
```

Tags include:

```text
latest
commit SHA
```

Example:

```text
ghcr.io/zeez000/ecommerce-product-service:latest
```

---

# 20. Kubernetes

Folder:

```text
k8s/
```

The Kubernetes configuration uses Kustomize.

Main command:

```bash
kubectl apply -k k8s
```

What gets created:

- namespace
- ConfigMap
- MongoDB PersistentVolumeClaim
- MongoDB Deployment
- MongoDB Service
- Redis Deployment
- Redis Service
- Kafka Deployment
- Kafka Service
- Product Service Deployment
- Inventory Service Deployment
- Order Service Deployment
- API Gateway Deployment
- Services for each application
- Ingress

---

# 21. Kubernetes namespace

File:

```text
k8s/namespace.yaml
```

Everything is placed inside:

```text
ecommerce
```

Check:

```bash
kubectl get all -n ecommerce
```

---

# 22. Kubernetes ConfigMap

File:

```text
k8s/configmap.yaml
```

Stores non-secret application configuration.

Examples:

```text
KAFKA_BROKER
MONGO_URI
REDIS_URL
CACHE_TTL_SECONDS
```

These values are injected into the containers.

---

# 23. Kubernetes Deployments

Deployments manage application Pods.

Example:

```text
product-service
inventory-service
order-service
api-gateway
```

Each application deployment currently uses:

```text
replicas: 2
```

This demonstrates horizontal application replication.

---

# 24. Readiness and liveness probes

Kubernetes uses:

```text
/health
```

Readiness probe answers:

> Is this container ready to receive traffic?

Liveness probe answers:

> Is this container still alive and functioning?

If readiness fails:

```text
Kubernetes temporarily removes the Pod from Service traffic
```

If liveness repeatedly fails:

```text
Kubernetes restarts the container
```

---

# 25. Kubernetes Services

Pods can be replaced and receive different IP addresses.

A Kubernetes Service provides a stable network identity.

Example:

```text
product-service:3000
inventory-service:3001
order-service:3002
```

This allows containers to communicate without caring which exact Pod is running.

---

# 26. Kubernetes Ingress

File:

```text
k8s/ingress.yaml
```

Development hostname:

```text
ecommerce.local
```

Traffic flow:

```text
browser
   |
   v
Ingress
   |
   v
api-gateway Service
   |
   v
api-gateway Pods
```

An NGINX Ingress Controller is required.

---

# 27. Persistent MongoDB storage

Kubernetes file:

```text
k8s/mongodb.yaml
```

MongoDB uses a PersistentVolumeClaim.

Why:

Without persistent storage:

```text
Pod deleted
   |
   v
database data could disappear
```

With persistent storage:

```text
Pod deleted/recreated
   |
   v
data volume remains
```

---

# 28. Resource requests and limits

Kubernetes application manifests include:

```text
resources.requests
resources.limits
```

Requests tell Kubernetes how much resource a Pod expects.

Limits define the maximum allowed.

Examples:

```text
CPU
memory
```

This is important for scheduling and stability.

---

# 29. Prometheus

Configuration:

```text
monitoring/prometheus.yml
```

Prometheus collects metrics from:

```text
API Gateway
Product Service
Inventory Service
Order Service
```

Each application exposes:

```text
/metrics
```

Example:

```bash
curl http://localhost:3000/metrics
```

---

# 30. Grafana

Grafana visualizes metrics collected by Prometheus.

Start monitoring stack:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.monitoring.yml \
  up --build -d
```

Prometheus:

```text
http://localhost:9090
```

Grafana:

```text
http://localhost:3003
```

Local development login:

```text
username: admin
password: admin
```

Do not use these credentials in a real environment.

---

# 31. Useful Docker commands

List running containers:

```bash
docker ps
```

List Compose services:

```bash
docker compose ps
```

Build again:

```bash
docker compose build
```

Restart one service:

```bash
docker compose restart order-service
```

Enter a container:

```bash
docker exec -it order-service sh
```

View Kafka logs:

```bash
docker compose logs -f kafka
```

View MongoDB logs:

```bash
docker compose logs -f mongodb
```

---

# 32. Useful Kubernetes commands

Render manifests without deploying:

```bash
kubectl kustomize k8s
```

Deploy:

```bash
kubectl apply -k k8s
```

List resources:

```bash
kubectl get all -n ecommerce
```

List Pods:

```bash
kubectl get pods -n ecommerce
```

Watch Pods:

```bash
kubectl get pods -n ecommerce -w
```

View logs:

```bash
kubectl logs -n ecommerce deployment/product-service
```

Describe a Pod:

```bash
kubectl describe pod POD_NAME -n ecommerce
```

Delete everything:

```bash
kubectl delete -k k8s
```

---

# 33. How service discovery works

## Docker Compose

Docker provides DNS using Compose service names.

Example:

```text
product-service
kafka
mongodb
redis
```

So inside a container:

```text
localhost
```

means:

```text
this same container
```

while:

```text
mongodb
```

means:

```text
MongoDB container
```

## Kubernetes

Kubernetes Services provide DNS.

Example:

```text
mongodb
kafka
redis
product-service
```

Applications use these names instead of fixed IP addresses.

---

# 34. Environment variables

Documentation file:

```text
.env.example
```

Variables:

```text
MONGO_URI
REDIS_URL
KAFKA_BROKER
CACHE_TTL_SECONDS
```

Example:

```text
MONGO_URI=mongodb://mongodb:27017/ecommerce
REDIS_URL=redis://redis:6379
KAFKA_BROKER=kafka:9092
CACHE_TTL_SECONDS=60
```

---

# 35. Health checks vs metrics

Health checks tell orchestration tools whether a service is operational.

Endpoint:

```text
/health
```

Metrics provide numerical observability information.

Endpoint:

```text
/metrics
```

They solve different problems.

```text
/health -> should traffic be sent here?
/metrics -> how is this service behaving?
```

---

# 36. Failure examples

## Kafka unavailable

Application startup retry logic attempts to reconnect.

Without retries:

```text
service starts
Kafka not ready yet
service crashes
```

With retries:

```text
service starts
Kafka unavailable
wait
retry
Kafka ready
connect successfully
```

---

## MongoDB unavailable

Services retry the connection rather than immediately failing permanently.

---

## Insufficient inventory

Order:

```text
quantity = 5
```

Stock:

```text
quantity = 2
```

Result:

```text
inventory.rejected
reason = Insufficient stock
```

Order becomes:

```text
rejected
```

---

# 37. Why Kafka instead of direct REST calls?

A simpler system could do:

```text
Product Service
      |
      | HTTP
      v
Inventory Service
```

This strongly couples the two services.

With events:

```text
Product Service
      |
      | event
      v
Kafka
      |
      v
Inventory Service
```

Product Service does not need to know how Inventory Service processes the event.

This improves separation between services.

---

# 38. Why Redis?

Without Redis:

```text
every product-list request
      |
      v
MongoDB
```

With Redis:

```text
request
   |
   v
Redis
   |
   +-- hit --> response
   |
   +-- miss --> MongoDB --> Redis --> response
```

This reduces repeated database reads.

---

# 39. Why Docker?

Docker makes the environment reproducible.

Instead of manually installing:

```text
Node
MongoDB
Redis
Kafka
```

you run:

```bash
docker compose up
```

and the required environment is created automatically.

---

# 40. Why Kubernetes?

Docker Compose is excellent for local development.

Kubernetes adds features needed for larger deployments:

- scheduling
- self-healing
- service discovery
- replicas
- rolling deployments
- persistent storage
- health probes
- resource management
- load balancing

So the learning path in this repository is:

```text
application
   |
   v
Docker
   |
   v
Docker Compose
   |
   v
CI
   |
   v
container registry
   |
   v
Kubernetes
   |
   v
monitoring
```

---

# 41. What CI means here

CI stands for Continuous Integration.

In this project:

```text
code pushed
   |
   v
automated workflow
   |
   v
dependencies install
   |
   v
Docker validation
   |
   v
image builds
   |
   v
stack starts
   |
   v
real end-to-end test
```

If something breaks, the workflow should fail before broken code is treated as ready.

---

# 42. What CD would mean

The repository currently publishes container images.

A fuller CD pipeline could later do:

```text
CI success
   |
   v
build image
   |
   v
push registry
   |
   v
deploy Kubernetes
   |
   v
verify rollout
```

For AWS, that could eventually become:

```text
GitHub Actions
     |
     v
GHCR / ECR
     |
     v
EKS
```

---

# 43. Current production gaps

This is a serious portfolio project, but not yet a production e-commerce platform.

Important future improvements include:

- authentication
- authorization
- HTTPS/TLS
- Kubernetes Secrets
- secret manager integration
- Kafka authentication
- Kafka encryption
- dead-letter queues
- retry topics
- schema validation
- event versioning
- idempotency
- duplicate-event handling
- distributed tracing
- centralized logging
- real Prometheus application metrics
- alerting
- rate limiting
- API validation
- unit tests
- larger integration-test coverage
- automated rollback
- backup/restore procedures
- managed database services
- managed Kafka
- autoscaling
- infrastructure as code
- production AWS networking

---

# 44. Recommended next steps

Suggested order:

```text
1. Make current CI fully green
2. Merge devops-completion
3. Publish GHCR images
4. Test Kubernetes locally using Minikube or kind
5. Add Terraform
6. Build AWS networking
7. Deploy to EKS
8. Add AWS-managed persistence/messaging where appropriate
9. Improve Prometheus metrics
10. Build Grafana dashboards
11. Add alerts
12. Add distributed tracing
13. Add authentication/security
```

---

# 45. Skills demonstrated by this project

This project demonstrates hands-on experience with:

## Development

- Node.js
- Express.js
- REST APIs
- asynchronous workflows

## Databases

- MongoDB
- Redis

## Messaging

- Apache Kafka
- Kafka producers
- Kafka consumers
- consumer groups
- event correlation
- asynchronous architecture

## Containers

- Docker
- Dockerfiles
- Docker Compose
- container networking
- container health checks

## DevOps

- Git
- GitHub
- GitHub Actions
- CI pipelines
- container registries
- automated smoke testing

## Kubernetes

- Deployments
- Services
- ConfigMaps
- PersistentVolumeClaims
- probes
- resource requests and limits
- Ingress
- Kustomize

## Observability

- health endpoints
- Prometheus
- Grafana
- metrics endpoints

## Engineering concepts

- microservices
- event-driven architecture
- service discovery
- cache invalidation
- race-condition reduction
- retries
- fault tolerance
- horizontal scaling
- separation of concerns

---

# 46. Quick start cheat sheet

Start:

```bash
docker compose up --build -d
```

Check:

```bash
docker compose ps
```

Gateway:

```bash
curl http://localhost:8080/health
```

Smoke test:

```bash
bash scripts/smoke-test.sh
```

Logs:

```bash
docker compose logs -f
```

Monitoring:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Prometheus:

```text
http://localhost:9090
```

Grafana:

```text
http://localhost:3003
```

Kubernetes render:

```bash
kubectl kustomize k8s
```

Kubernetes deploy:

```bash
kubectl apply -k k8s
```

Kubernetes status:

```bash
kubectl get all -n ecommerce
```

---

# 47. Project goal

The purpose of this repository is not only to build an e-commerce backend.

It is designed to demonstrate the complete engineering journey:

```text
Application Development
        |
        v
Microservices
        |
        v
Event-Driven Architecture
        |
        v
Containers
        |
        v
CI
        |
        v
Container Registry
        |
        v
Kubernetes
        |
        v
Observability
        |
        v
Cloud Infrastructure
```

That makes the project useful both as a learning environment and as a DevOps portfolio project.
