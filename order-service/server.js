const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

const kafka = new Kafka({
    clientId: "order-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
});

const producer = kafka.producer();
const consumer = kafka.consumer({
    groupId: "order-service-group"
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

const orderSchema = new mongoose.Schema(
    {
        productId: {
            type: String,
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        status: {
            type: String,
            enum: ["pending", "confirmed", "rejected"],
            default: "pending"
        },
        rejectionReason: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

const Order = mongoose.model("Order", orderSchema);

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "order-service",
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
        "service_up{service=\"order-service\"} 1",
        "# HELP process_uptime_seconds Process uptime in seconds.",
        "# TYPE process_uptime_seconds gauge",
        `process_uptime_seconds{service="order-service"} ${process.uptime()}`
    ].join("\n") + "\n");
});

async function publishOrderEvent(order) {
    await producer.send({
        topic: "order-events",
        messages: [
            {
                key: order.productId,
                value: JSON.stringify({
                    event: "order.created",
                    orderId: order._id.toString(),
                    productId: order.productId,
                    quantity: order.quantity
                })
            }
        ]
    });
}

async function handleInventoryEvent(event) {
    if (!event.orderId) {
        console.warn("Ignoring inventory event without orderId:", event);
        return;
    }

    if (event.event === "inventory.reserved") {
        const updatedOrder = await Order.findOneAndUpdate(
            {
                _id: event.orderId,
                status: "pending"
            },
            {
                status: "confirmed",
                rejectionReason: null
            },
            {
                new: true
            }
        );

        console.log(
            "Order confirmed:",
            updatedOrder?._id || "No matching pending order"
        );
    }

    if (event.event === "inventory.rejected") {
        const updatedOrder = await Order.findOneAndUpdate(
            {
                _id: event.orderId,
                status: "pending"
            },
            {
                status: "rejected",
                rejectionReason: event.reason
            },
            {
                new: true
            }
        );

        console.log(
            "Order rejected:",
            updatedOrder?._id || "No matching pending order",
            event.reason
        );
    }
}

async function startConsumer() {
    await retry(() => consumer.connect(), "Kafka consumer connection");

    await consumer.subscribe({
        topic: "inventory-events",
        fromBeginning: false
    });

    consumer.run({
        eachMessage: async ({ message }) => {
            try {
                const event = JSON.parse(message.value.toString());
                console.log("Order Service received event:", event);
                await handleInventoryEvent(event);
            } catch (error) {
                console.error("Kafka event processing failed:", error);
            }
        }
    }).catch((error) => {
        console.error("Kafka consumer run loop failed:", error);
        process.exit(1);
    });
}

app.post("/orders", async (req, res) => {
    try {
        const { productId, quantity } = req.body;

        if (!productId || !Number.isInteger(quantity) || quantity < 1) {
            return res.status(400).json({
                message: "productId and a positive integer quantity are required"
            });
        }

        const order = await Order.create({
            productId,
            quantity,
            status: "pending"
        });

        await publishOrderEvent(order);

        res.status(201).json(order);
    } catch (error) {
        console.error("Order creation failed:", error);

        res.status(500).json({
            message: "Failed to create order"
        });
    }
});

app.get("/orders", async (req, res) => {
    try {
        const orders = await Order.find().sort({
            createdAt: -1
        });

        res.json(orders);
    } catch (error) {
        console.error("Failed to fetch orders:", error);

        res.status(500).json({
            message: "Failed to fetch orders"
        });
    }
});

app.get("/orders/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({
                message: "Order not found"
            });
        }

        res.json(order);
    } catch (error) {
        res.status(400).json({
            message: "Invalid order ID"
        });
    }
});

async function startOrderService() {
    try {
        await retry(
            () => mongoose.connect(process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce", {
                serverSelectionTimeoutMS: 5000,
                family: 4
            }),
            "MongoDB connection"
        );

        await retry(() => producer.connect(), "Kafka producer connection");
        await startConsumer();

        app.listen(PORT, () => {
            console.log(`Order Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Order Service startup failed:", error);
        process.exit(1);
    }
}

async function shutdown() {
    console.log("Shutting down Order Service");

    await Promise.allSettled([
        consumer.disconnect(),
        producer.disconnect(),
        mongoose.disconnect()
    ]);

    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startOrderService();
