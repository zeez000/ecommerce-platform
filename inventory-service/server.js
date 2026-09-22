const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const kafka = new Kafka({
    clientId: "inventory-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
});

const consumer = kafka.consumer({
    groupId: "inventory-service-group"
});

const producer = kafka.producer();

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

const inventorySchema = new mongoose.Schema(
    {
        productId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        productName: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            default: 0,
            min: 0
        }
    },
    {
        timestamps: true
    }
);

const Inventory = mongoose.model("Inventory", inventorySchema);

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "inventory-service",
        status: "healthy",
        mongoReady: mongoose.connection.readyState === 1,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get("/metrics", (req, res) => {
    res.type("text/plain; version=0.0.4");
    res.send([
        "# HELP service_up Whether the service process is running.",
        "# TYPE service_up gauge",
        "service_up{service=\"inventory-service\"} 1",
        "# HELP process_uptime_seconds Process uptime in seconds.",
        "# TYPE process_uptime_seconds gauge",
        `process_uptime_seconds{service="inventory-service"} ${process.uptime()}`
    ].join("\n") + "\n");
});

async function publishInventoryEvent(event) {
    await producer.send({
        topic: "inventory-events",
        messages: [
            {
                key: event.productId,
                value: JSON.stringify(event)
            }
        ]
    });
}

async function handleProductCreated(event) {
    const inventory = await Inventory.findOneAndUpdate(
        {
            productId: event.productId
        },
        {
            $setOnInsert: {
                productId: event.productId,
                productName: event.name,
                quantity: 0
            }
        },
        {
            upsert: true,
            new: true
        }
    );

    console.log("Inventory ready for product:", inventory.productId);
}

async function handleOrderCreated(event) {
    if (!event.orderId) {
        console.warn("Ignoring order.created event without orderId:", event);
        return;
    }

    const inventory = await Inventory.findOneAndUpdate(
        {
            productId: event.productId,
            quantity: {
                $gte: event.quantity
            }
        },
        {
            $inc: {
                quantity: -event.quantity
            }
        },
        {
            new: true
        }
    );

    if (inventory) {
        await publishInventoryEvent({
            event: "inventory.reserved",
            orderId: event.orderId,
            productId: event.productId,
            quantity: event.quantity,
            remainingStock: inventory.quantity
        });

        console.log("Inventory reserved for order:", event.orderId);
        return;
    }

    const existingInventory = await Inventory.findOne({
        productId: event.productId
    });

    const reason = existingInventory
        ? "Insufficient stock"
        : "Product not found";

    await publishInventoryEvent({
        event: "inventory.rejected",
        orderId: event.orderId,
        productId: event.productId,
        quantity: event.quantity,
        reason
    });

    console.log("Inventory rejected for order:", event.orderId, reason);
}

async function startConsumer() {
    await retry(() => consumer.connect(), "Kafka consumer connection");
    await retry(() => producer.connect(), "Kafka producer connection");

    await consumer.subscribe({
        topics: ["product-events", "order-events"],
        fromBeginning: false
    });

    await consumer.run({
        eachMessage: async ({ message }) => {
            try {
                const event = JSON.parse(message.value.toString());

                console.log("Inventory Service received event:", event);

                if (event.event === "product.created") {
                    await handleProductCreated(event);
                }

                if (event.event === "order.created") {
                    await handleOrderCreated(event);
                }
            } catch (error) {
                console.error("Inventory event processing failed:", error);
            }
        }
    });
}

app.get("/", (req, res) => {
    res.json({
        message: "Inventory Service is running!"
    });
});

app.put("/inventory/:productId", async (req, res) => {
    try {
        const quantity = Number(req.body.quantity);

        if (!Number.isFinite(quantity) || quantity < 0) {
            return res.status(400).json({
                message: "quantity must be a non-negative number"
            });
        }

        const inventory = await Inventory.findOneAndUpdate(
            {
                productId: req.params.productId
            },
            {
                quantity
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!inventory) {
            return res.status(404).json({
                message: "Inventory not found"
            });
        }

        await publishInventoryEvent({
            event: "inventory.updated",
            productId: inventory.productId,
            productName: inventory.productName,
            quantity: inventory.quantity
        });

        res.json(inventory);
    } catch (error) {
        console.error("Failed to update inventory:", error);
        res.status(400).json({
            message: "Failed to update inventory"
        });
    }
});

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

async function startInventoryService() {
    try {
        await retry(
            () => mongoose.connect(process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce", {
                serverSelectionTimeoutMS: 5000,
                family: 4
            }),
            "MongoDB connection"
        );

        await startConsumer();

        app.listen(PORT, () => {
            console.log(`Inventory Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Inventory Service startup failed:", error);
        process.exit(1);
    }
}

async function shutdown() {
    console.log("Shutting down Inventory Service");

    await Promise.allSettled([
        consumer.disconnect(),
        producer.disconnect(),
        mongoose.disconnect()
    ]);

    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startInventoryService();
