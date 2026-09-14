const express = require("express");
const mongoose = require("mongoose");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3002;

const kafka = new Kafka({
    clientId: "order-service",
    brokers: [process.env.KAFKA_BROKER || "kafka:9092"]
    
});

const producer = kafka.producer();

const consumer = kafka.consumer({
    groupId: "order-service-group"
});

app.use(express.json());

// Health check route
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "order-service",
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});
/* MongoDB connection */
mongoose
    .connect(
    process.env.MONGO_URI || "mongodb://mongodb:27017/ecommerce"
)
    .then(() => {
        console.log("Order Service connected to MongoDB");
    })
    .catch((error) => {
        console.error("MongoDB connection failed:", error);
    });

/* Order schema */
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

/* Kafka consumer */
async function startConsumer() {
    await consumer.connect();

    console.log("Order Service consumer connected to Kafka");

    await consumer.subscribe({
        topic: "inventory-events",
        fromBeginning: false
    });

    await consumer.run({
        eachMessage: async ({ message }) => {
            try {
                const event = JSON.parse(message.value.toString());

                console.log("Order Service received event:", event);

                if (event.event === "inventory.reserved") {
                    const updatedOrder = await Order.findOneAndUpdate(
                        {
                            productId: event.productId,
                            status: "pending"
                        },
                        {
                            status: "confirmed"
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
                            productId: event.productId,
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
            } catch (error) {
                console.error("Kafka event processing failed:", error);
            }
        }
    });
}

/* Create order */
app.post("/orders", async (req, res) => {
    try {
        const { productId, quantity } = req.body;

        if (!productId || !quantity || quantity < 1) {
            return res.status(400).json({
                message: "productId and valid quantity are required"
            });
        }

        const order = await Order.create({
            productId,
            quantity,
            status: "pending"
        });

        await producer.send({
            topic: "order-events",
            messages: [
                {
                    key: productId,
                    value: JSON.stringify({
                        event: "order.created",
                        orderId: order._id.toString(),
                        productId,
                        quantity
                    })
                }
            ]
        });

        console.log("Order created:", order);
        console.log("Order event published to Kafka");

        res.status(201).json(order);
    } catch (error) {
        console.error("Order creation failed:", error);

        res.status(500).json({
            message: "Failed to create order"
        });
    }
});

/* Get all orders */
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

/* Get one order */
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

/* Start service */
async function startOrderService() {
    try {
        await producer.connect();

        console.log("Order Service producer connected to Kafka");

        await startConsumer();

        app.listen(PORT, () => {
            console.log(`Order Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Order Service startup failed:", error);
    }
}

startOrderService();
