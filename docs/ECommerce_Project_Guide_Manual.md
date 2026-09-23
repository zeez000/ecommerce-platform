# Event-Driven E-Commerce Platform — Project Guide & Technical Manual

> Repository copy of the project manual. The formatted DOCX edition contains the same guide with richer page layout and screenshots.

PROJECT GUIDE + TECHNICAL MANUAL
Event-Driven
E-Commerce Platform
A live microservices system that connects commerce, messaging, containers, CI/CD and observability.
MICROSERVICES
APACHE KAFKA
DOCKER + COMPOSE

KUBERNETES
GITHUB ACTIONS
PROMETHEUS + GRAFANA

Repository: zeez000/ecommerce-platform | Primary branch: main | Updated: 23 Sep 2026

Current validated state
The Docker Compose/Codespaces path is working end-to-end. The latest GitHub Actions push and pull-request runs pass the build, health checks, Kafka business flow, frontend check and smoke test.

Use this manual as a project reference, demonstration guide and interview study document.

START HERE
How to use this manual
This document explains what the project is, which technologies it uses, how the services communicate, how the live interface works, how the CI/CD and infrastructure pieces fit together, and how to run or demonstrate the system.
Section
What you will learn

1. Project overview
Purpose, scope and the one-minute explanation.

2. Live interface
What a user sees and what each page section does.

3. Architecture
How browser, gateway, services, data stores and Kafka connect.

4. Technology stack
Technologies, versions and their role in the project.

5. Core services
API Gateway, Product, Inventory and Order responsibilities.

6. Business workflows
Product creation, stock management, confirmed and rejected orders.

7. APIs and data
Routes, data objects, health and metrics endpoints.

8. DevOps
Docker Compose, CI, GHCR, Kubernetes and monitoring.

9. Run and demo
Local/Codespaces startup, live sharing and troubleshooting.

10. Next steps
Known limitations and sensible production improvements.

WHAT IT IS
1. Project overview
One-line description
A production-style learning project that demonstrates an event-driven e-commerce system using independent microservices, Kafka events, persistent storage, caching, Docker, CI/CD, Kubernetes manifests and a live interactive frontend.

What the platform does
The platform simulates the core flow of an e-commerce system. Products are created independently, inventory is created and updated through an Inventory Service, and orders are confirmed or rejected based on stock. Instead of tightly coupling every service with direct HTTP calls, Kafka carries important business events between services.
Create and browse products.
Automatically create an inventory record when a product is created.
Set or update stock for a product.
Place an order and observe the pending -> confirmed or pending -> rejected lifecycle.
Cache product-list reads with Redis.
Expose a single client entry point through an API Gateway.
Run the complete system as containers with Docker Compose.
Validate the end-to-end workflow automatically in GitHub Actions.
Provide Kubernetes/Kustomize manifests and Prometheus/Grafana monitoring support.
What this project is designed to demonstrate
ARCHITECTURE
MESSAGING
DELIVERY
OPERATIONS

Microservices
Independent services
Kafka
Async event flow
CI/CD
Build + smoke test
Health + metrics
Observable services

This is a portfolio and learning platform, not a complete retail product. It intentionally focuses on distributed-system behavior, service boundaries, container orchestration, reliability and DevOps workflow rather than payments, authentication, shipping or a production checkout experience.
WHAT THE USER SEES
2. The live working interface
The frontend is branded as FORM / FLOW and presents the system as an interactive commerce study. It is not a mock dashboard: the controls call the real backend services through the frontend Nginx proxy and API Gateway.

Figure 1. Live frontend running against the Docker Compose microservices stack.
Interface map
Area
Purpose
What is live behind it

Hero - "Commerce in motion"
Introduces the experience and links into the working system.
Frontend state + live system indicator.

01 / The Collection
Shows products, prices and stock; lets you create products, order them or edit stock.
Product Service + Inventory Service + MongoDB + Redis + Kafka.

02 / The Order Cycle
Shows order history and status transitions.
Order Service + MongoDB + Kafka inventory responses.

03 / Under the Surface
Visualizes service health and the distributed architecture.
API Gateway /system/health aggregation.

04 / Signal Path
Displays browser-observed actions and explains event-driven exchange.
Client-side event feed reflecting live API actions.

Order modal
Choose quantity and submit an order.
POST to Order Service through /api and API Gateway.

Inventory modal
Set available stock for a product.
PUT to Inventory Service, followed by inventory.updated event.

How the frontend talks to the backend
The browser never needs to know the internal container hostnames. It talks to the same frontend origin using /api. Nginx forwards /api requests to the API Gateway and strips the /api prefix. This keeps the UI portable and avoids hardcoding localhost service URLs in browser JavaScript.
Browser
  |
  | /api/...
  v
Frontend Nginx :3005
  |
  | proxy_pass -> api-gateway:8080
  v
API Gateway
  |
  +-> Product Service :3000
  +-> Inventory Service :3001
  +-> Order Service :3002

The frontend reloads products, inventory, orders and service health on initial load and then polls approximately every 6 seconds while the page is visible. User actions also trigger immediate refreshes, toasts and event-feed entries.

SYSTEM DESIGN
3. High-level architecture
BROWSER / LIVE FRONTEND
HTML + CSS + JavaScript served by Nginx on port 3005

|
V
API GATEWAY :8080
Single client-facing entry point for product, inventory and order APIs

|
V
PRODUCT SERVICE :3000
Products + Redis cache + product.created
INVENTORY SERVICE :3001
Stock + reservations + inventory events
ORDER SERVICE :3002
Orders + pending/confirmed/rejected state

|
V
MONGODB :27017
Persistent products, inventories and orders
REDIS :6379
Product-list cache
KAFKA :9092
product-events / order-events / inventory-events

Two communication styles
Style
Where it is used
Why

Synchronous REST
Browser -> Nginx -> API Gateway -> services; product/inventory/order reads and commands.
The client needs an immediate HTTP response.

Asynchronous Kafka events
Product -> Inventory; Order -> Inventory; Inventory -> Order.
Services can react independently and remain loosely coupled.

Kafka topics
Topic
Publisher
Consumer
Key events

product-events
Product Service
Inventory Service
product.created

order-events
Order Service
Inventory Service
order.created

inventory-events
Inventory Service
Order Service
inventory.updated, inventory.reserved, inventory.rejected

WHAT IT HAS
4. Technology stack
Layer
Technology
Role in this project

Frontend
HTML5, CSS, JavaScript
Interactive commerce interface, modals, polling, toasts, order/inventory controls and event feed.

Frontend server
Nginx 1.27-alpine
Serves static UI and proxies /api to the API Gateway.

Backend
Node.js + Express
Runs API Gateway and the Product, Inventory and Order services.

Service-to-service events
Apache Kafka 4.0.1 + KafkaJS 2.2.4
Asynchronous product, order and inventory event flow. Kafka runs in KRaft mode.

Database
MongoDB 7 + Mongoose
Persists products, inventory and orders.

Cache
Redis 7-alpine
Caches the product list in Product Service with a 60-second TTL and invalidation on writes.

Containerization
Docker + Docker Compose
Builds and orchestrates the full local/Codespaces stack with health-aware startup.

CI
GitHub Actions
Installs dependencies, validates Compose, builds images, starts the stack and runs an end-to-end smoke test.

Container registry
GitHub Container Registry (GHCR)
Publishes application images from main with latest and commit-SHA tags.

Orchestration manifests
Kubernetes + Kustomize
Defines namespace, config, deployments, services, probes, resources, storage and ingress.

Monitoring
Prometheus 3.5.0 + Grafana 12.1.1
Scrapes /metrics endpoints and provides visualization support.

Cloud dev/demo
GitHub Codespaces
Runs the complete Docker stack remotely and can forward port 3005 for a live demo.

Backend library versions worth knowing
Component
Important packages

API Gateway
Express 5.2.1; http-proxy-middleware 4.2.0

Product Service
Express 5.2.1; KafkaJS 2.2.4; Mongoose 9.9.4; redis client 6.2.1

Inventory Service
Express 4.21.2; KafkaJS 2.2.4; Mongoose 8.9.5

Order Service
Express 4.21.2; KafkaJS 2.2.4; Mongoose 8.9.5

RESPONSIBILITIES
5. Core services
API Gateway
The API Gateway is the single HTTP entry point for backend APIs. It forwards /products to Product Service, /inventory to Inventory Service and /orders to Order Service. It also exposes /health, /metrics and /system/health. The system-health endpoint actively checks the gateway plus the three application services and returns an aggregated service map for the frontend.
Product Service
Creates, lists, reads, updates and deletes products.
Stores products in MongoDB.
Caches the product list in Redis under the products key.
Invalidates the product cache after create/update/delete operations.
Publishes product.created to product-events when a new product is created.
Exposes /health and /metrics.
Why Redis matters here
The first product-list request can read MongoDB and cache the result. Later reads can come from Redis until the TTL expires or a product write invalidates the cache. This demonstrates a simple cache-aside pattern.

Inventory Service
Consumes both product-events and order-events.
Creates inventory records idempotently when product.created is received.
Allows stock to be set manually through PUT /inventory/:productId.
Publishes inventory.updated after a manual stock change.
Reserves stock atomically when order.created is received.
Publishes inventory.reserved when stock is sufficient.
Publishes inventory.rejected with a reason when stock is insufficient or the product is missing.
Concurrency protection
Stock reservation uses a conditional MongoDB update: the record is updated only when quantity >= requested amount. This avoids a simple read-check-write race and reduces overselling risk.

Order Service
Creates orders with status pending.
Publishes order.created with both orderId and productId.
Consumes inventory-events.
Changes exactly the matching pending order to confirmed after inventory.reserved.
Changes exactly the matching pending order to rejected after inventory.rejected and stores the rejection reason.
Lists orders and returns a single order by ID.
Why orderId is carried through Kafka
The correlation ID prevents two pending orders for the same product from updating the wrong database row. The inventory response points back to the exact order that initiated the reservation.

END-TO-END FLOW
6. How the business workflow works
Workflow A - Create a product
1. The user enters product name, price and optional starting stock in the Collection section.
2. The browser sends POST /api/products/products.
3. Nginx forwards the request to API Gateway, which forwards it to Product Service.
4. Product Service saves the product in MongoDB and invalidates the Redis product-list cache.
5. Product Service publishes product.created to the product-events Kafka topic.
6. Inventory Service consumes product.created and creates an inventory record with quantity 0 if one does not already exist.
7. The frontend waits for that inventory record to appear, then sets the requested starting stock through Inventory Service.
8. The UI refreshes products/inventory and shows the new item live in the collection.
User -> Frontend -> API Gateway -> Product Service -> MongoDB
                                      |
                                      +-> Kafka: product.created
                                              |
                                              v
                                      Inventory Service
                                              |
                                              v
                                      inventory record (qty 0)

Workflow B - Place an order with enough stock
1. The user chooses a product and quantity in the order modal.
2. The browser sends POST /api/orders/orders.
3. Order Service writes a new order to MongoDB with status pending.
4. Order Service publishes order.created with orderId, productId and quantity.
5. Inventory Service consumes the event and performs an atomic conditional decrement.
6. If stock is available, Inventory Service publishes inventory.reserved with orderId and remainingStock.
7. Order Service consumes inventory.reserved and updates that exact pending order to confirmed.
8. The frontend polls/refreshes and displays the confirmed state and reduced stock.
order.created
Order Service --------------------> Kafka --------------------> Inventory Service
    ^                                                            |
    |                                                            | stock reserved
    |                                                            v
    +--------------------- inventory.reserved <---------------- Kafka
    |
    +-> order status = confirmed

Workflow C - Place an order without enough stock
1. The order begins in pending exactly like a normal order.
2. Inventory Service tries the same conditional stock update.
3. If the condition fails, it determines whether the reason is Insufficient stock or Product not found.
4. Inventory Service publishes inventory.rejected with the orderId and reason.
5. Order Service changes that exact pending order to rejected and stores the reason.
6. Inventory quantity is left unchanged.
Order lifecycle
State
Meaning
Who changes it

pending
Order has been created and is waiting for an inventory decision.
Order Service on creation

confirmed
Inventory was reserved successfully.
Order Service after inventory.reserved

rejected
Inventory could not be reserved.
Order Service after inventory.rejected

INTERFACES
7. APIs, routes and data
Client-facing path
In the live frontend, the browser uses /api paths on port 3005. After Nginx removes /api, API Gateway routes requests by the first path segment.
Browser request
Gateway route
Destination

/api/products/products
/products/...
Product Service :3000

/api/inventory/inventory
/inventory/...
Inventory Service :3001

/api/orders/orders
/orders/...
Order Service :3002

/api/system/health
/system/health
API Gateway health aggregator

Important service endpoints
Service
Method + route
Purpose

Product
GET /products
List products (Redis cached).

Product
GET /products/:id
Read one product.

Product
POST /products
Create product and publish product.created.

Product
PUT /products/:id
Update product and invalidate cache.

Product
DELETE /products/:id
Delete product and invalidate cache.

Inventory
GET /inventory
List inventory records.

Inventory
PUT /inventory/:productId
Set product stock and publish inventory.updated.

Order
POST /orders
Create a pending order and publish order.created.

Order
GET /orders
List orders.

Order
GET /orders/:id
Read one order.

All app services
GET /health
Service health information.

All app services
GET /metrics
Prometheus text metrics.

Core data objects
Object
Typical fields
Notes

Product
_id, name, price
Created by Product Service; cached as a list in Redis.

Inventory
productId, productName, quantity
Created from product.created; quantity changes independently.

Order
_id, productId, quantity, status, rejectionReason
Starts pending and is finalized by inventory events.

HOW IT RUNS
8. Docker and local orchestration
Docker Compose is the validated runtime for local development and GitHub Codespaces. It creates the network, persistent MongoDB volume, infrastructure containers and application containers, then uses health-aware dependencies so higher-level services do not start blindly.
Service
Host port
Container role

Frontend
3005
Nginx serves the UI on container port 80.

API Gateway
8080
Client entry point for backend routes.

Product Service
3000
Product API, Redis cache, product events.

Inventory Service
3001
Stock API and Kafka consumer/producer.

Order Service
3002
Order API and Kafka consumer/producer.

MongoDB
27017
Persistent application data.

Redis
6379
Product cache.

Kafka
9092
Event broker; single-node KRaft configuration.

Health-aware startup
MongoDB, Redis and Kafka have explicit health checks. Product Service waits for MongoDB, Redis and Kafka; Inventory and Order wait for MongoDB and Kafka; API Gateway waits for all three application services; the frontend waits for API Gateway. This produces a predictable startup sequence and improves CI reliability.
Persistent data
MongoDB uses the named Docker volume mongodb_data. A normal docker compose down keeps the volume; docker compose down -v deletes it and resets stored products, inventory and orders.
AUTOMATION
9. CI/CD and container delivery
GitHub Actions CI
The CI workflow runs on pushes to main/devops-completion and on pull requests to main. It validates configuration, builds the images, boots the full stack, waits for eight healthy containers plus working frontend/gateway URLs, and runs the smoke test.
Checkout
  -> Setup Node.js 22
  -> Install service dependencies
  -> Validate Compose + monitoring overlay
  -> Build Docker images
  -> Start full stack
  -> Wait for 8 healthy containers + frontend/API checks
  -> Run scripts/smoke-test.sh
  -> Print status/logs
  -> Tear down

What the smoke test proves
API Gateway is healthy.
A product can be created.
Inventory is automatically created from product.created.
Stock can be set.
A valid order becomes confirmed and reduces stock correctly.
An insufficient-stock order becomes rejected and does not reduce stock.
The frontend returns HTML on port 3005.
The frontend /api proxy can reach gateway health.
Current result
The latest push and pull-request Build and Smoke Test runs on devops-completion are passing, including the redesigned frontend and the confirmed/rejected order checks.

GHCR publishing
On pushes to main that touch application code, the Publish Container Images workflow builds and pushes API Gateway, Product, Inventory, Order and Frontend images to GitHub Container Registry. Images receive both latest and commit-SHA tags.
ghcr.io/zeez000/ecommerce-api-gateway
ghcr.io/zeez000/ecommerce-product-service
ghcr.io/zeez000/ecommerce-inventory-service
ghcr.io/zeez000/ecommerce-order-service
ghcr.io/zeez000/ecommerce-frontend

ORCHESTRATION MANIFESTS
10. Kubernetes layer
The k8s/ directory is Kustomize-ready and defines the ecommerce namespace, shared ConfigMap, MongoDB/Redis/Kafka infrastructure, application deployments and services, frontend deployment, persistent storage for MongoDB and an Nginx Ingress definition.
Capability
Current implementation

Namespace
All resources live in ecommerce.

App replicas
Product, Inventory, Order, API Gateway and Frontend are configured with replicas: 2.

Service discovery
Stable Kubernetes Services use product-service, inventory-service, order-service, api-gateway, mongodb, redis and kafka names.

Health
Readiness and liveness probes use /health for backend apps and / for frontend.

Resources
CPU/memory requests and limits are set for application deployments.

Persistence
MongoDB uses a PersistentVolumeClaim.

Configuration
ConfigMap provides KAFKA_BROKER, MONGO_URI, REDIS_URL and CACHE_TTL_SECONDS.

Ingress
ecommerce.local routes / and /api using Nginx Ingress.

Kubernetes routing note
The Compose/Codespaces path is the currently validated end-to-end runtime. In the Kubernetes Ingress, /api is sent directly to API Gateway, while the local frontend Nginx strips /api before forwarding. Before using the manifests in a real cluster, add the appropriate Nginx rewrite behavior or route traffic through the frontend so /api semantics match the validated local setup.

OPERATIONS
11. Monitoring and observability
Each backend service exposes a lightweight Prometheus-compatible /metrics endpoint with service_up and process_uptime_seconds. Prometheus scrapes API Gateway, Product, Inventory and Order. Grafana is provided as the visualization layer in the monitoring Compose overlay.
Component
Port / endpoint
Purpose

Service health
/health
Health response used by Docker/Kubernetes and displayed by the frontend system view.

Service metrics
/metrics
Prometheus text metrics for app uptime/availability.

Prometheus
localhost:9090
Scrapes backend service metrics every 15 seconds.

Grafana
localhost:3003
Visualizes Prometheus data; local dev admin/admin credentials are configured.

Frontend system health
/api/system/health
Shows live status for gateway, product, inventory and order services.

What is observable today
Container health state in docker compose ps.
Service health endpoints and dependency-ready flags.
Basic Prometheus uptime metrics.
Frontend system-health visualization.
Application logs for Kafka events, order confirmation/rejection and startup retry behavior.
GitHub Actions logs and automatic log dump on CI failure.
LOCAL OR CODESPACES
12. Run the project
Normal startup
git checkout main
docker compose up --build -d
docker compose ps

When everything is ready, the expected application URLs are:
Purpose
URL

Live frontend
http://localhost:3005

API Gateway
http://localhost:8080

Product Service
http://localhost:3000

Inventory Service
http://localhost:3001

Order Service
http://localhost:3002

Prometheus (monitoring overlay)
http://localhost:9090

Grafana (monitoring overlay)
http://localhost:3003

GitHub Codespaces startup
The project has a Codespaces-specific helper because the environment can retain stale legacy firewall rules after Docker networking changes. If containers resolve each other by name but TCP connections time out, run the repair script before starting Compose.
bash scripts/fix-codespace-docker-network.sh
docker compose up --build -d
docker compose ps

What the repair does
It checks for a stale iptables-legacy FORWARD DROP policy and inserts an allow rule for Docker user-bridge traffic in the legacy DOCKER-USER chain. It does not change MongoDB addresses or application code.

Open the live frontend in Codespaces
1. Open the Codespace in the browser/VS Code web interface.
2. Open the bottom panel and click Ports.
3. Find port 3005.
4. Choose Open in Browser to view the live UI.
5. For a temporary external demo, change port 3005 visibility to Public and share the forwarded URL.
6. Return the port to Private after the demo because there is no authentication on the application.
Stop/reset
docker compose down
# Full reset including MongoDB volume:
docker compose down -v

HOW TO SHOW IT
13. Demonstration guide
30-second introduction
"This is an event-driven e-commerce platform. Product, Inventory and Order are independent services. Kafka carries business events between them, MongoDB stores state, Redis caches products, Docker runs the stack, and GitHub Actions validates the whole flow. The frontend lets me trigger the real workflow live."

Recommended live demo sequence
1. Open the hero and point out the All systems live status.
2. Scroll to The Collection and create a product with a starting stock quantity.
3. Explain that Product Service saves the product and publishes product.created; Inventory Service creates its own inventory record from the event.
4. Use Update inventory once to show stock is independently managed.
5. Place an order with enough stock. Show pending becoming confirmed and stock decreasing.
6. Place another order for more stock than remains. Show the order becoming rejected while stock stays unchanged.
7. Open The system section to show the independent services and health state.
8. Open Signal Path and explain that the important backend transitions are driven by Kafka topics.
9. Mention that the same workflow is automatically reproduced by scripts/smoke-test.sh in GitHub Actions.
If someone asks "what was the hardest issue?"
A strong troubleshooting example is the Codespaces Docker networking failure. MongoDB was healthy and DNS resolved correctly, but container-to-container connections timed out. The root cause was stale iptables-legacy forwarding rules dropping traffic on Docker bridge networks. The fix moved the investigation below the application layer and became a reusable repair script documented in the repository.
COMMON CHECKS
14. Troubleshooting quick reference
Symptom
Check
Likely action

A service is unhealthy
docker compose ps; docker compose logs --tail=150 SERVICE
Read the first real dependency/application error before changing code.

MongoDB/Kafka name resolves but connection times out in Codespaces
Docker network membership + iptables legacy forwarding
Run scripts/fix-codespace-docker-network.sh.

Frontend opens but APIs fail
curl http://localhost:3005/api/health and http://localhost:8080/health
Check Nginx proxy and API Gateway health.

Product appears but inventory does not
Inventory Service logs; Kafka product-events subscription
Check product.created consumption and topic readiness.

Order stays pending
Order + Inventory logs; order-events and inventory-events
Confirm inventory decision event includes the same orderId.

CI fails only at frontend check
Frontend health and curl readiness
CI already includes retries; review current frontend health/logs.

Need a clean database
Persistent volume keeps data
docker compose down -v, then start again.

PRODUCTION PERSPECTIVE
15. Current limitations and next steps
The project intentionally demonstrates architecture and DevOps concepts without pretending to be a production retail platform. The following additions would be reasonable next steps if you wanted to take it further.
Area
Current state
Next improvement

Authentication
No user sign-in; public demo visitors can mutate data.
Add identity, roles and protected write endpoints.

Kafka resilience
Single broker; auto-created topics.
Define topics explicitly, add replication for multi-broker deployment, retry/DLQ strategy and schema management.

Payments/shipping
Not implemented.
Add dedicated services and event contracts only if required by project scope.

Observability
Basic uptime metrics and logs.
Add request latency/error metrics, dashboards, tracing and centralized logs.

Security
Local/dev defaults, no secrets layer.
Use secrets management, TLS, non-root containers, image scanning and network policies.

Kubernetes
Manifests included; Compose is the validated end-to-end path.
Fix /api ingress rewrite behavior, deploy to a test cluster, add autoscaling and production storage classes.

Testing
End-to-end smoke test is strong; no service unit-test suite yet.
Add unit/integration tests around service logic and event handlers.

Availability
Single MongoDB, Redis and Kafka containers in Compose.
Use managed/replicated data services for real production availability.

QUICK STUDY REFERENCE
16. Glossary
Term
Meaning in this project

Microservice
An independently running service responsible for a focused business capability.

API Gateway
The client-facing HTTP entry point that routes requests to internal services.

Event-driven
Services react to messages/events rather than only direct synchronous calls.

Kafka topic
A named stream of events, such as order-events.

Producer
A service that publishes a Kafka message.

Consumer
A service that reads and handles Kafka messages.

Correlation ID
An identifier such as orderId used to connect an async response to the correct request/entity.

Atomic update
A single database operation that checks and changes state together, reducing race conditions.

Cache-aside
Application checks cache first, falls back to the database, then stores the result in cache.

Health check
A request/command used to determine whether a service/container is working.

Readiness probe
Kubernetes check that determines whether a Pod should receive traffic.

Liveness probe
Kubernetes check that determines whether a container should be restarted.

Smoke test
A compact end-to-end test that proves the main system workflow works.

KRaft
Kafka metadata/controller mode that removes the ZooKeeper dependency.

Kustomize
Kubernetes configuration composition supported by kubectl apply -k.

THE TAKEAWAY
17. Project summary
The strongest part of this project is not any single technology. It is the way the pieces work together: a real browser triggers a gateway, independent services own their own responsibilities, Kafka coordinates asynchronous decisions, MongoDB and Redis manage state/performance, Docker gives a reproducible runtime, GitHub Actions proves the workflow automatically, and Kubernetes/Prometheus/Grafana extend the project into deployment and operations concerns.
How to describe it in one sentence
"It is a containerized, event-driven e-commerce microservices platform where Kafka coordinates product, inventory and order workflows, with a live frontend and automated end-to-end CI validation."

End of manual.
E-Commerce Microservices Platform  |  Project Guide
Page
