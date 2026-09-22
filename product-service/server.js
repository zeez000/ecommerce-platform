const { createClient } = require("redis");
const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_KEY = "products";
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60);

app.use(express.json());

const kafka = new Kafka({
    clientId: "product-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
});

const producer = kafka.producer();

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://redis:6379"
});

redisClient.on("error", (error) => {
    console.error("Redis error:", error);
});

async function retry(operation, label, attempts = 20, delayMs = 3000) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.error(`${label} attempt ${attempt}/${attempts} failed:`, error.message);

            if (attempt < attempts) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    throw lastError;
}

async function invalidateProductCache() {
    if (redisClient.isReady) {
        await redisClient.del(CACHE_KEY);
    }
}

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        price: {
            type: Number,
            required: true,
            min: 0
        }
    },
    {
        timestamps: true
    }
);

const Product = mongoose.model("Product", productSchema);

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "product-service",
        status: "healthy",
        mongoReady: mongoose.connection.readyState === 1,
        redisReady: redisClient.isReady,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get("/metrics", (req, res) => {
    res.type("text/plain; version=0.0.4");
    res.send([
        "# HELP service_up Whether the service process is running.",
        "# TYPE service_up gauge",
        "service_up{service=\"product-service\"} 1",
        "# HELP process_uptime_seconds Process uptime in seconds.",
        "# TYPE process_uptime_seconds gauge",
        `process_uptime_seconds{service="product-service"} ${process.uptime()}`
    ].join("\n") + "\n");
});

app.get("/", (req, res) => {
    res.json({
        message: "E-Commerce Product Service is running!"
    });
});

app.get("/products", async (req, res) => {
    try {
        const cachedProducts = await redisClient.get(CACHE_KEY);

        if (cachedProducts) {
            return res.json(JSON.parse(cachedProducts));
        }

        const products = await Product.find();

        await redisClient.setEx(
            CACHE_KEY,
            CACHE_TTL_SECONDS,
            JSON.stringify(products)
        );

        res.json(products);
    } catch (error) {
        console.error("Failed to fetch products:", error);
        res.status(500).json({
            message: "Failed to fetch products"
        });
    }
});

app.get("/products/:id", async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        res.json(product);
    } catch (error) {
        res.status(400).json({
            message: "Invalid product ID"
        });
    }
});

app.post("/products", async (req, res) => {
    try {
        const product = new Product({
            name: req.body.name,
            price: req.body.price
        });

        const savedProduct = await product.save();

        await producer.send({
            topic: "product-events",
            messages: [
                {
                    key: savedProduct._id.toString(),
                    value: JSON.stringify({
                        event: "product.created",
                        productId: savedProduct._id.toString(),
                        name: savedProduct.name,
                        price: savedProduct.price
                    })
                }
            ]
        });

        await invalidateProductCache();

        console.log("Product created event published to Kafka");

        res.status(201).json(savedProduct);
    } catch (error) {
        console.error("Failed to create product:", error);
        res.status(400).json({
            message: "Failed to create product"
        });
    }
});

app.put("/products/:id", async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            {
                name: req.body.name,
                price: req.body.price
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        await invalidateProductCache();

        res.json(product);
    } catch (error) {
        res.status(400).json({
            message: "Invalid product data or product ID"
        });
    }
});

app.delete("/products/:id", async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        await invalidateProductCache();

        res.json({
            message: "Product deleted successfully"
        });
    } catch (error) {
        res.status(400).json({
            message: "Invalid product ID"
        });
    }
});

async function startProductService() {
    try {
        await retry(
            () => mongoose.connect(process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce", {
                serverSelectionTimeoutMS: 5000,
                family: 4
            }),
            "MongoDB connection"
        );

        await retry(() => redisClient.connect(), "Redis connection");
        await retry(() => producer.connect(), "Kafka producer connection");

        app.listen(PORT, () => {
            console.log(`Product Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Product Service startup failed:", error);
        process.exit(1);
    }
}

async function shutdown() {
    console.log("Shutting down Product Service");

    await Promise.allSettled([
        producer.disconnect(),
        redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
        mongoose.disconnect()
    ]);

    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startProductService();
