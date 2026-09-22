const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "api-gateway",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get("/metrics", (req, res) => {
    res.type("text/plain; version=0.0.4");
    res.send([
        "# HELP service_up Whether the service process is running.",
        "# TYPE service_up gauge",
        "service_up{service=\"api-gateway\"} 1",
        "# HELP process_uptime_seconds Process uptime in seconds.",
        "# TYPE process_uptime_seconds gauge",
        `process_uptime_seconds{service="api-gateway"} ${process.uptime()}`
    ].join("\n") + "\n");
});

app.use(
    "/products",
    createProxyMiddleware({
        target: "http://product-service:3000",
        changeOrigin: true
    })
);

app.use(
    "/inventory",
    createProxyMiddleware({
        target: "http://inventory-service:3001",
        changeOrigin: true
    })
);

app.use(
    "/orders",
    createProxyMiddleware({
        target: "http://order-service:3002",
        changeOrigin: true
    })
);

app.get("/", (req, res) => {
    res.json({
        service: "E-commerce API Gateway",
        status: "running",
        routes: {
            products: "/products",
            inventory: "/inventory",
            orders: "/orders"
        }
    });
});

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
