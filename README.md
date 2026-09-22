# Event-Driven E-Commerce Microservices Platform

A portfolio-focused DevOps and distributed-systems project built with Node.js, Express, MongoDB, Redis, Apache Kafka, Docker, GitHub Actions, Kubernetes, Prometheus, and Grafana.

## Architecture

```text
                         API Gateway :8080
                       /        |        \
                      /         |         \
        Product Service   Inventory Service   Order Service
            :3000              :3001              :3002
              |                  |                  |
           MongoDB            MongoDB            MongoDB
              |
            Redis

        product-events ────────┐
                               v
                         Inventory Service
                               |
        order-events ──────────┤
                               |
                               v
                        inventory-events
                               |
                               v
                          Order Service
```

The platform uses synchronous REST APIs for client-facing operations and Kafka events for asynchronous product, inventory, and order workflows.

## What is implemented

- API Gateway routing for Product, Inventory, and Order services
- Independent Node.js/Express microservices
- MongoDB persistence
- Redis product-list caching with cache invalidation
- Kafka event-driven workflows
- Product-created events automatically create inventory records
- Order-created events reserve inventory
- Inventory reservation/rejection events update the exact originating order using `orderId`
- Atomic inventory decrement to reduce overselling risk
- Dockerfiles for every application service
- Docker Compose orchestration with health checks
- Startup retry logic for MongoDB, Redis, and Kafka dependencies
- Health and Prometheus-style metrics endpoints
- GitHub Actions build + full-stack end-to-end smoke testing
- Kubernetes manifests with probes, resources, persistent MongoDB storage, Services, and Ingress
- Prometheus and Grafana local observability stack
- GHCR image publishing workflow

## Event flow

### Product creation

```text
POST product
    |
    v
Product Service
    |
    | product.created
    v
product-events
    |
    v
Inventory Service
    |
    v
Inventory record created
```

### Order reservation

```text
POST order
    |
    v
Order Service
    |
    | order.created + orderId
    v
order-events
    |
    v
Inventory Service
    |
    +--> stock available
    |       |
    |       v
    |   atomic decrement
    |       |
    |       | inventory.reserved + orderId
    |       v
    |   inventory-events
    |       |
    |       v
    |   Order Service -> confirmed
    |
    +--> insufficient/missing stock
            |
            | inventory.rejected + orderId
            v
        inventory-events
            |
            v
        Order Service -> rejected
```

## Run locally

Requirements:

- Docker
- Docker Compose

Start the stack:

```bash
docker compose up --build -d
```

Check services:

```bash
docker compose ps
curl http://localhost:8080/health
```

Run the full end-to-end smoke test:

```bash
bash scripts/smoke-test.sh
```

Stop everything:

```bash
docker compose down
```

To remove local persisted MongoDB data as well:

```bash
docker compose down -v
```

## API examples

Create a product:

```bash
curl -X POST http://localhost:8080/products/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Keyboard","price":2499}'
```

List inventory:

```bash
curl http://localhost:8080/inventory/inventory
```

Set stock:

```bash
curl -X PUT http://localhost:8080/inventory/inventory/PRODUCT_ID \
  -H "Content-Type: application/json" \
  -d '{"quantity":10}'
```

Create an order:

```bash
curl -X POST http://localhost:8080/orders/orders \
  -H "Content-Type: application/json" \
  -d '{"productId":"PRODUCT_ID","quantity":2}'
```

Get an order:

```bash
curl http://localhost:8080/orders/orders/ORDER_ID
```

## CI pipeline

The GitHub Actions CI workflow:

1. checks out the repository
2. installs Node.js dependencies
3. validates Docker Compose
4. builds all application images
5. starts the complete stack
6. waits for health readiness
7. executes the end-to-end smoke test
8. verifies product -> inventory -> order -> Kafka reservation -> order confirmation
9. captures logs on failure
10. tears down the environment

This validates real service interaction instead of only checking whether Docker images compile.

## Container registry

On pushes to `main`, the image publishing workflow builds and pushes:

- `ghcr.io/zeez000/ecommerce-api-gateway`
- `ghcr.io/zeez000/ecommerce-product-service`
- `ghcr.io/zeez000/ecommerce-inventory-service`
- `ghcr.io/zeez000/ecommerce-order-service`

Images receive both `latest` and commit-SHA tags.

## Kubernetes

The `k8s/` directory contains a Kustomize-compatible deployment.

Resources include:

- dedicated `ecommerce` namespace
- MongoDB PVC + Deployment + Service
- Redis Deployment + Service
- Kafka KRaft Deployment + Service
- Product, Inventory, Order, and API Gateway Deployments
- readiness and liveness probes
- CPU/memory requests and limits
- ConfigMap-based service configuration
- NGINX Ingress route

Render manifests:

```bash
kubectl kustomize k8s
```

Deploy:

```bash
kubectl apply -k k8s
```

Inspect:

```bash
kubectl get all -n ecommerce
```

The included Ingress expects an NGINX Ingress Controller and uses the development hostname `ecommerce.local`.

## Monitoring

Start the application plus monitoring stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up --build -d
```

Prometheus:

```text
http://localhost:9090
```

Grafana:

```text
http://localhost:3003
```

Development credentials:

```text
username: admin
password: admin
```

Change these credentials before using the monitoring stack anywhere beyond a local lab.

Each application service exposes:

```text
/health
/metrics
```

## Repository structure

```text
.
├── .github/workflows/
│   ├── ci.yml
│   └── publish-images.yml
├── api-gateway/
├── product-service/
├── inventory-service/
├── order-service/
├── k8s/
├── monitoring/
├── scripts/
│   └── smoke-test.sh
├── docker-compose.yml
├── docker-compose.monitoring.yml
└── README.md
```

## Reliability improvements implemented

Earlier versions of this project had two important distributed-system problems:

1. the Product Service published `product.created` to `product-events`, while Inventory only consumed `order-events`
2. Order Service matched inventory responses using `productId`, which could update the wrong pending order when multiple orders existed for the same product

The current architecture subscribes Inventory to both required topics and carries the unique `orderId` through the full event chain.

Stock reservation is performed using a conditional atomic MongoDB update:

```text
quantity >= requested quantity
        |
        v
$inc quantity by -requested quantity
```

This is safer than loading an inventory record, checking it in application code, and saving the modified quantity later.

## Current scope and production gaps

This repository is designed as a hands-on DevOps/microservices portfolio project. Before treating it as a production commerce platform, additional work would include:

- authentication and authorization
- TLS and secrets management
- Kafka authentication/encryption
- managed databases/message brokers
- schema validation and API versioning
- dead-letter queues and retry policies
- idempotency keys and stronger event deduplication
- distributed tracing
- structured logging
- full unit/integration test suites
- database backup/restore procedures
- managed Kubernetes/cloud infrastructure
- autoscaling and production SLOs

## Tech stack

**Application:** Node.js, Express.js  
**Data:** MongoDB, Redis  
**Messaging:** Apache Kafka / KafkaJS  
**Containers:** Docker, Docker Compose  
**CI:** GitHub Actions  
**Orchestration:** Kubernetes / Kustomize  
**Observability:** Prometheus, Grafana  
**Version control:** Git / GitHub
