const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const mqtt = require("mqtt");
const WebSocket = require("ws");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");
const configRouter = require("./routers/config-router");
const publishRouter = require("./routers/publish-route");
const wifiRouter = require("./routers/wi-fiUser");
const subscribeRouter = require("./routers/subscribe-router");
const firmware = require("./routers/firmware")
const http = require("http");

const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });
const wsClients = []; // Store WebSocket clients

wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");
  wsClients.push(ws);

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    const index = wsClients.indexOf(ws);
    if (index > -1) {
      wsClients.splice(index, 1);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// MQTT Client Management
const mqttHandlers = new Map();
const connectedBrokers = new Map();
const userEmailCache = new Map();

// Middleware to attach mqttHandlers, connectedBrokers, and wsClients to req
app.use((req, res, next) => {
  req.mqttHandlers = mqttHandlers;
  req.connectedBrokers = connectedBrokers;
  req.wsClients = wsClients;
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
app.use('/api/pub', publishRouter);
app.use('/api', wifiRouter);
app.use('/api', subscribeRouter);
app.use('/api', firmware);

// Initialize MQTT Client
const setupMqttClient = () => {
  const brokerUrl = "mqtt://localhost:1883"; // Replace with your MQTT broker URL
  const clientId = `server_${Math.random().toString(16).slice(3)}`;
  const client = mqtt.connect(brokerUrl, { clientId });

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
    mqttHandlers.delete(clientId);
    connectedBrokers.delete(clientId);
    console.log("MQTT client removed:", clientId);
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
    handler.end();
  });
  mqttHandlers.clear();
  connectedBrokers.clear();
  wsClients.forEach((client) => client.close());
  server.close(() => {
    console.log("Server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});