const { createClient } = require("redis");
const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3000;

// Kafka setup
const kafka = new Kafka({
    clientId: "product-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
});

const producer = kafka.producer();

async function connectKafka() {
    await producer.connect();
    console.log("Connected to Kafka");
}

connectKafka().catch((error) => {
    console.error("Kafka connection failed:", error);
});


// Redis setup
const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://redis:6379"
});

redisClient.on("error", (error) => {
    console.error("Redis error:", error);
});

async function connectRedis() {
    await redisClient.connect();
    console.log("Connected to Redis");
}

connectRedis().catch((error) => {
    console.error("Redis connection failed:", error);
});
// Middleware
app.use(express.json());


// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "product-service",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
// Connect to MongoDB
mongoose.connect(
    process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce")
    .then(() => {
        console.log("Connected to MongoDB");
    })
    .catch((error) => {
        console.error("MongoDB connection failed:", error);
    });

// Product schema
const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    }
});

// Product model
const Product = mongoose.model("Product", productSchema);

// Home route
app.get("/", (req, res) => {
    res.json({
        message: "E-Commerce Product Service is running!"
    });
});

// GET all products
app.get("/products", async (req, res) => {
    try {
        const cachedProducts = await redisClient.get("products");

        if (cachedProducts) {
            console.log("CACHE HIT");
            return res.json(JSON.parse(cachedProducts));
        }

        console.log("CACHE MISS");

        const products = await Product.find();

        await redisClient.setEx(
            "products",
            60,
            JSON.stringify(products)
        );

        res.json(products);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch products"
        });
    }
});

// GET one product
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

// CREATE product
app.post("/products", async (req, res) => {
    try {
        const product = new Product({
            name: req.body.name,
            price: req.body.price
        });

        const savedProduct = await product.save();

        // Publish product-created event to Kafka
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

        console.log("Product created event published to Kafka");

        res.status(201).json(savedProduct);

    } catch (error) {
        console.error("Failed to create product:", error);

        res.status(400).json({
            message: "Failed to create product"
        });
    }
});

// UPDATE product
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

        res.json(product);

    } catch (error) {
        res.status(400).json({
            message: "Invalid product ID"
        });
    }
});

// DELETE product
app.delete("/products/:id", async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        res.json({
            message: "Product deleted successfully"
        });

    } catch (error) {
        res.status(400).json({
            message: "Invalid product ID"
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Product Service running on port ${PORT}`);
});
