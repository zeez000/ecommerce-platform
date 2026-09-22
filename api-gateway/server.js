const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "api-gateway",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get("/system/health", async (req, res) => {
    const targets = {
        "api-gateway": "http://localhost:8080/health",
        "product-service": "http://product-service:3000/health",
        "inventory-service": "http://inventory-service:3001/health",
        "order-service": "http://order-service:3002/health"
    };

    const results = await Promise.all(
        Object.entries(targets).map(async ([name, url]) => {
            try {
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(2500)
                });

                if (!response.ok) {
                    throw new Error("Health check failed");
                }

                const data = await response.json();

                return [
                    name,
                    {
                        status: data.status || "healthy",
                        uptime: data.uptime ?? null,
                        timestamp: data.timestamp ?? null
                    }
                ];
            } catch (error) {
                return [
                    name,
                    {
                        status: "offline",
                        error: error.message
                    }
                ];
            }
        })
    );

    const services = Object.fromEntries(results);
    const healthy = Object.values(services).filter(
        (service) => service.status === "healthy"
    ).length;

    res.status(200).json({
        status: healthy === Object.keys(services).length ? "healthy" : "degraded",
        healthy,
        total: Object.keys(services).length,
        services,
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
            orders: "/orders",
            systemHealth: "/system/health"
        }
    });
});

app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
