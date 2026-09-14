const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "api-gateway",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
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

