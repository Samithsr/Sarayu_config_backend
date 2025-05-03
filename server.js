const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Routes
app.use('/api/auth', authRouter);
app.use('/api', brokerRouter);

// MongoDB Connection
mongoose
    .connect("mongodb://localhost:27017/gateway")
    .then(async () => {
        console.log("Database connection successful!");
        app.listen(5000, () => {
            console.log("Listening on port 5000");
        });
    })
    .catch((err) => {
        console.error("Database connection failed:", err.message);
    });