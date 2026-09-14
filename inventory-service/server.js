const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "inventory-service",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// MongoDB
mongoose.connect(
    process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce"
)

    .then(() => {
        console.log("Inventory Service connected to MongoDB");
    })
    .catch((error) => {
        console.error("MongoDB connection failed:", error);
    });

// Kafka
const kafka = new Kafka({
    clientId: "inventory-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
});

const consumer = kafka.consumer({
    groupId: "inventory-service-group"
});
const producer = kafka.producer();
// Inventory schema
const inventorySchema = new mongoose.Schema({
    productId: {
        type: String,
        required: true,
        unique: true
    },
    productName: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        default: 0
    }
});

const Inventory = mongoose.model("Inventory", inventorySchema);

// Start Kafka consumer
async function startConsumer() {
    await consumer.connect();
    await producer.connect();
    console.log("Inventory Service connected to Kafka");

    await consumer.subscribe({
        topic: "order-events",
        fromBeginning: true
});

    await consumer.run({
        eachMessage: async ({ message }) => {
            const event = JSON.parse(message.value.toString());

            console.log("Received event:", event);

            if (event.event === "product.created") {
                await Inventory.create({
                    productId: event.productId,
                    productName: event.name,
                    quantity: 0
                });

                console.log(
                    `Inventory created for product: ${event.name}`
                );
            }
if (event.event === "order.created") {
    const inventory = await Inventory.findOne({
        productId: event.productId
    });

    if (!inventory) {
        console.log(
            `Inventory not found for product: ${event.productId}`
        );

        await producer.send({
            topic: "inventory-events",
            messages: [
                {
                    key: event.productId,
                    value: JSON.stringify({
                        event: "inventory.rejected",
                        productId: event.productId,
                        quantity: event.quantity,
                        reason: "Product not found"
                    })
                }
            ]
        });

        return;
    }

    if (inventory.quantity < event.quantity) {
        console.log(
            `Insufficient stock for product: ${event.productId}`
        );

        await producer.send({
            topic: "inventory-events",
            messages: [
                {
                    key: event.productId,
                    value: JSON.stringify({
                        event: "inventory.rejected",
                        productId: event.productId,
                        quantity: event.quantity,
                        reason: "Insufficient stock"
                    })
                }
            ]
        });

        return;
    }

    inventory.quantity -= event.quantity;

    await inventory.save();

    console.log(
        `Stock reduced for ${event.productId}. New quantity: ${inventory.quantity}`
    );

    await producer.send({
        topic: "inventory-events",
        messages: [
            {
                key: event.productId,
                value: JSON.stringify({
                    event: "inventory.reserved",
                    productId: event.productId,
                    quantity: event.quantity,
                    remainingStock: inventory.quantity
                })
            }
        ]
    });

    console.log("Inventory reserved event published to Kafka");
}
        }
    });
}

startConsumer().catch((error) => {
    console.error("Kafka consumer failed:", error);
});

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Inventory Service is running!"
    });
});
// Update inventory quantity
app.put("/inventory/:productId", async (req, res) => {
    try {
        const { quantity } = req.body;

        const inventory = await Inventory.findOneAndUpdate(
            { productId: req.params.productId },
            { quantity: quantity },
            { new: true, runValidators: true }
        );

        if (!inventory) {
            return res.status(404).json({
                message: "Inventory not found"
            });
        }

        await producer.send({
    topic: "inventory-events",
    messages: [
        {
            key: inventory.productId,
            value: JSON.stringify({
                event: "inventory.updated",
                productId: inventory.productId,
                productName: inventory.productName,
                quantity: inventory.quantity
            })
        }
    ]
});

console.log("Inventory updated event published to Kafka");

res.json(inventory);

    } catch (error) {
        console.error(error);
        res.status(400).json({
            message: "Failed to update inventory"
        });
    }
});
// Get inventory
app.get("/inventory", async (req, res) => {
    try {
        const inventory = await Inventory.find();
        res.json(inventory);
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch inventory"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Inventory Service running on port ${PORT}`);
});
