const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const mqtt = require("mqtt");
const http = require("http");
const { Server } = require("socket.io");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");
const configRouter = require("./routers/config-router");
const publishRouter = require("./routers/publish-route");
const wifiRouter = require("./routers/wi-fiUser");
const subscribeRouter = require("./routers/subscribe-router");
const firmware = require("./routers/firmware-router");
const location = require("./routers/location");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity; restrict in production
    methods: ["GET", "POST"],
  },
});

// Load environment variables
require("dotenv").config();
const MQTT_USERNAME = process.env.MQTT_USERNAME || "Sarayu"; // Set in .env file
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "IOTteam@123"; // Set in .env file
const SERVER_IP = process.env.SERVER_IP || "13.201.135.43"; // Updated to AWS IP

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "*", // Allow all origins for simplicity; restrict in production
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"], // Allow clients to access download headers
  })
);

// Simple token verification function (replace with your auth logic)
const verifyToken = async (token) => {
  // Replace this with your actual token verification logic from authRouter
  // For example, check against a user database or JWT verification
  return !!token; // Placeholder: assumes token is valid if present
};

// Socket.IO connection handling
io.on("connection", async (socket) => {
  const token = socket.handshake.query.token;

  if (!token || !(await verifyToken(token))) {
    console.error("Socket.IO connection rejected: Invalid or missing token");
    socket.emit("error", { message: "Unauthorized" });
    socket.disconnect(true);
    return;
  }

  console.log("New Socket.IO client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Socket.IO client disconnected:", socket.id);
  });

  socket.on("error", (error) => {
    console.error("Socket.IO error:", error);
  });
});

// MQTT Client Management
const mqttHandlers = new Map();
const connectedBrokers = new Map();
const userEmailCache = new Map();

// Middleware to attach mqttHandlers, connectedBrokers, io, and server IP to req
app.use((req, res, next) => {
  req.mqttHandlers = mqttHandlers;
  req.connectedBrokers = connectedBrokers;
  req.io = io; // Attach Socket.IO instance instead of wsClients
  req.serverIp = SERVER_IP; // Pass server IP to routes
  next();
});

// Routes
app.use("/api/auth", authRouter);
app.use("/api", brokerRouter);
app.use("/api", configRouter);
app.use("/api/pub", publishRouter);
app.use("/api", wifiRouter);
app.use("/api", subscribeRouter);
app.use("/api", firmware);
app.use("/api", location);

// Initialize MQTT Client
const setupMqttClient = (brokerIp = "13.201.135.43") => {
  const brokerUrl = process.env.MQTT_BROKER_URL || `mqtt://${brokerIp}:1883`; // Use provided or default IP
  const clientId = `server_${Math.random().toString(16).slice(3)}`;
  const client = mqtt.connect(brokerUrl, {
    clientId,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    connectTimeout: 5000,
    reconnectPeriod: 1000, // Enable automatic reconnection with 1-second delay
  });

  client.on("connect", () => {
    console.log(`Connected to MQTT broker at ${brokerUrl} with clientId ${clientId}`);
    mqttHandlers.set(clientId, client);
    connectedBrokers.set(clientId, { client, url: brokerUrl });
    console.log("MQTT client registered:", { clientId, brokerUrl });
  });

  client.on("error", (err) => {
    console.error(`MQTT connection error for ${brokerUrl}:`, err.message);
  });

  client.on("close", () => {
    console.log(`Disconnected from MQTT broker at ${brokerUrl}`);
    // Do not remove from mqttHandlers or connectedBrokers to allow reconnection
  });

  client.on("reconnect", () => {
    console.log(`Attempting to reconnect to MQTT broker at ${brokerUrl}`);
  });

  return client;
};

// Connect to MQTT broker on startup
setupMqttClient();

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI || "mongodb://13.201.135.43:27017/sami")
  .then(() => {
    console.log("Database connection successful!");
    const PORT = process.env.PORT || 5000;
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
    handler.end(true); // Forcefully end the client
  });
  mqttHandlers.clear();
  connectedBrokers.clear();
  io.close(() => {
    console.log("Socket.IO server closed.");
  });
  server.close(() => {
    console.log("Server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});