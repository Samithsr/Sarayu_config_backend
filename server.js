const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");
const configRouter = require("./routers/config-router");
const http = require("http");

const app = express();
const server = http.createServer(app);

// MQTT Client Management
const mqttHandlers = new Map();
const connectedBrokers = new Map(); // Track connected brokers
const userEmailCache = new Map(); // Cache user emails for performance

// Middleware to attach mqttHandlers and connectedBrokers to req
app.use((req, res, next) => {
  req.mqttHandlers = mqttHandlers;
  req.connectedBrokers = connectedBrokers;
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Routes
app.use('/api/auth', authRouter);
app.use('/api', brokerRouter);
app.use('/api', configRouter);

// MongoDB Connection
mongoose
  .connect("mongodb://localhost:27017/gateway")
  .then(() => {
    console.log("Database connection successful!");
    const PORT = 5000;
    server.listen(PORT, () => {
      console.log(`Listening on port ${PORT}`);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
      } else {
        console.error(`Server error: ${err.message}`);
        process.exit(1);
      }
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });

process.on("SIGINT", () => {
  console.log("Shutting down server...");
  mqttHandlers.forEach((handler, key) => {
    console.log(`Cleaning up MQTT handler for ${key}`);
    handler.disconnect();
  });
  mqttHandlers.clear();
  connectedBrokers.clear();
  server.close(() => {
    console.log("Server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});
