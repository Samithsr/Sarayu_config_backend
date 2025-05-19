const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");
const configRouter = require("./routers/config-router");
const http = require("http");
const { Server } = require("socket.io");
const Broker = require("./models/broker-model");
const jwt = require("jsonwebtoken");
const MqttHandler = require("./middlewares/mqtt-handler");
const restrictToadmin = require("./middlewares/restrictToadmin");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// MQTT Client Management
const mqttHandlers = new Map();
const userSockets = new Map(); // Map to store multiple socket IDs per user

// Middleware to attach io and mqttHandlers to req
app.use((req, res, next) => {
  req.io = io;
  req.mqttHandlers = mqttHandlers;
  next();
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api', brokerRouter);
app.use('/api', configRouter);

// Socket.IO Authentication Middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token?.split(" ")[1];
  if (!token) {
    console.error(`[User: Unknown] Socket authentication failed: No token provided`);
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    socket.userId = decoded._id;

    // Store socket ID in userSockets as a Set
    if (!userSockets.has(decoded._id)) {
      userSockets.set(decoded._id, new Set());
    }
    userSockets.get(decoded._id).add(socket.id);
    socket.join(decoded._id);
    console.log(`[User: ${decoded._id}] Socket authenticated and joined room ${decoded._id}. Socket ID: ${socket.id}`);
    console.log(`[User: ${decoded._id}] Active sockets: ${Array.from(userSockets.get(decoded._id)).join(", ")}`);
    next();
  } catch (error) {
    console.error(`[User: Unknown] Socket authentication failed: Invalid token`);
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", async (socket) => {
  console.log(`[User: ${socket.userId}] Socket connected: ${socket.id}`);

  try {
    const brokers = await Broker.find({ userId: socket.userId });
    console.log(`[User: ${socket.userId}] Found ${brokers.length} brokers`);
    if (brokers.length === 0) {
      console.log(`[User: ${socket.userId}] No brokers found`);
      socket.emit("error", { message: "No brokers found for this user" });
      return;
    }

    brokers.forEach((broker) => {
      const key = `${socket.userId}_${broker._id}`;
      if (!mqttHandlers.has(key)) {
        console.log(`[User: ${socket.userId}] Initializing MQTT handler for broker ${broker._id} (IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
        const mqttHandler = new MqttHandler(socket, socket.userId, broker);
        mqttHandlers.set(key, mqttHandler);
        mqttHandler.connect();
      } else {
        console.log(`[User: ${socket.userId}] Reusing MQTT handler for broker ${broker._id} (IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
        const mqttHandler = mqttHandlers.get(key);
        mqttHandler.updateSocket(socket);
        if (!mqttHandler.isConnected()) {
          mqttHandler.connect();
        } else {
          // Emit current status to ensure frontend is updated
          socket.emit("mqtt_status", { brokerId: broker._id, status: mqttHandler.connectionStatus });
        }
      }
    });
  } catch (error) {
    console.error(`[User: ${socket.userId}] Error initializing brokers: ${error.message}`);
    socket.emit("error", { message: `Failed to initialize brokers: ${error.message}` });
  }

  socket.on("connect_broker", async ({ brokerId }) => {
    console.log(`[User: ${socket.userId}] Received connect_broker request for broker ${brokerId}`);
    try {
      const broker = await Broker.findOne({ _id: brokerId, userId: socket.userId });
      if (!broker) {
        console.error(`[User: ${socket.userId}] Broker ${brokerId} not found`);
        socket.emit("error", { message: "Broker not found", brokerId });
        return;
      }
      console.log(`[User: ${socket.userId}] Connecting to broker ${brokerId} (IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
      const key = `${socket.userId}_${brokerId}`;
      if (!mqttHandlers.has(key)) {
        console.log(`[User: ${socket.userId}] Creating new MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
        const mqttHandler = new MqttHandler(socket, socket.userId, broker);
        mqttHandlers.set(key, mqttHandler);
        mqttHandler.connect();
      } else {
        console.log(`[User: ${socket.userId}] Reusing MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
        const mqttHandler = mqttHandlers.get(key);
        mqttHandler.updateSocket(socket);
        if (!mqttHandler.isConnected()) {
          mqttHandler.connect();
        } else {
          socket.emit("mqtt_status", { brokerId: broker._id, status: mqttHandler.connectionStatus });
        }
      }
    } catch (error) {
      console.error(`[User: ${socket.userId}] Failed to connect broker ${brokerId}: ${error.message}`);
      socket.emit("error", { message: `Failed to connect broker: ${error.message}`, brokerId });
    }
  });

  socket.on("subscribe", ({ brokerId, topic }) => {
    console.log(`[User: ${socket.userId}] Received subscribe request for topic ${topic} on broker ${brokerId}`);
    const mqttHandler = mqttHandlers.get(`${socket.userId}_${brokerId}`);
    if (mqttHandler && mqttHandler.isConnected()) {
      console.log(`[User: ${socket.userId}] Subscribing to topic ${topic} on broker ${brokerId}`);
      mqttHandler.subscribe(topic);
    } else {
      console.error(`[User: ${socket.userId}] MQTT handler not found or not connected for broker ${brokerId}`);
      socket.emit("error", { message: "MQTT handler not found or not connected", brokerId });
    }
  });

  socket.on("publish", ({ brokerId, topic, message, userId }) => {
    console.log(`[User: ${userId}] Received publish request for topic ${topic} on broker ${brokerId}`);
    console.log(`[User: ${userId}] Publish message content: ${message}`);
    const mqttHandler = mqttHandlers.get(`${userId}_${brokerId}`);
    if (mqttHandler) {
      if (mqttHandler.isConnected()) {
        console.log(`[User: ${userId}] Publishing to topic ${topic} on broker ${brokerId}`);
        mqttHandler.publish(topic, message);
      } else {
        console.error(`[User: ${userId}] MQTT handler not connected for broker ${brokerId}`);
        socket.emit("error", { message: "MQTT client not connected", brokerId });
      }
    } else {
      console.error(`[User: ${userId}] MQTT handler not found for broker ${brokerId}`);
      socket.emit("error", { message: "MQTT handler not found", brokerId });
    }
  });

  socket.on("broker_updated", async ({ broker }) => {
    console.log(`[User: ${socket.userId}] Broadcasting broker_updated event for broker ${broker._id}`);
    io.to(socket.userId).emit("broker_updated", { broker });
  });

  socket.on("disconnect", () => {
    console.log(`[User: ${socket.userId}] Socket disconnected: ${socket.id}`);
    if (userSockets.has(socket.userId)) {
      userSockets.get(socket.userId).delete(socket.id);
      if (userSockets.get(socket.userId).size === 0) {
        userSockets.delete(socket.userId);
      }
      console.log(`[User: ${socket.userId}] Remaining sockets: ${userSockets.has(socket.userId) ? Array.from(userSockets.get(socket.userId)).join(", ") : "none"}`);
    }
    setTimeout(() => {
      if (!userSockets.has(socket.userId)) {
        mqttHandlers.forEach((handler, key) => {
          if (key.startsWith(`${socket.userId}_`)) {
            console.log(`[User: ${socket.userId}] Cleaning up MQTT handler for ${key}`);
            handler.disconnect();
            mqttHandlers.delete(key);
          }
        });
      }
    }, 10000);
  });
});

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
        console.error(`Port ${PORT} is already in use. Please free the port or try a different one.`);
        console.error(`To find the process using port ${PORT}, run: netstat -aon | findstr :${PORT}`);
        console.error(`To terminate it, run: taskkill /PID <PID> /F`);
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
  server.close(() => {
    console.log("Server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});