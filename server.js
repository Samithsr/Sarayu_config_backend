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
const userSockets = new Map();

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
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    socket.userId = decoded._id;

    if (userSockets.has(decoded._id)) {
      const existingSocketId = userSockets.get(decoded._id);
      if (io.sockets.sockets.has(existingSocketId)) {
        return next(new Error("Another session is active. Please disconnect the existing session."));
      }
    }

    userSockets.set(decoded._id, socket.id);
    socket.join(decoded._id);
    next();
  } catch (error) {
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", async (socket) => {
  console.log(`Socket connected: ${socket.id} for user ${socket.userId}`);

  try {
    const brokers = await Broker.find({ userId: socket.userId });
    if (brokers.length === 0) {
      socket.emit("error", { message: "No brokers found for this user" });
      return;
    }

    brokers.forEach((broker) => {
      const key = `${socket.userId}_${broker._id}`;
      if (!mqttHandlers.has(key)) {
        console.log(`Initializing MQTT handler for broker ${broker._id} for user ${socket.userId}`);
        const mqttHandler = new MqttHandler(socket, socket.userId, broker);
        mqttHandlers.set(key, mqttHandler);
        mqttHandler.connect();
      } else {
        console.log(`Reusing MQTT handler for broker ${broker._id} for user ${socket.userId}`);
        const mqttHandler = mqttHandlers.get(key);
        mqttHandler.updateSocket(socket);
        if (!mqttHandler.isConnected()) {
          mqttHandler.connect();
        }
      }
    });
  } catch (error) {
    console.error(`Error initializing brokers for user ${socket.userId}: ${error.message}`);
    socket.emit("error", { message: `Failed to initialize brokers: ${error.message}` });
  }

  socket.on("connect_broker", async ({ brokerId }) => {
    try {
      console.log(`Received connect_broker request for broker ${brokerId} from user ${socket.userId}`);
      const broker = await Broker.findOne({ _id: brokerId, userId: socket.userId });
      if (!broker) {
        console.error(`Broker ${brokerId} not found for user ${socket.userId}`);
        socket.emit("error", { message: "Broker not found", brokerId });
        return;
      }
      const key = `${socket.userId}_${brokerId}`;
      if (!mqttHandlers.has(key)) {
        console.log(`Creating new MQTT handler for broker ${brokerId} for user ${socket.userId}`);
        const mqttHandler = new MqttHandler(socket, socket.userId, broker);
        mqttHandlers.set(key, mqttHandler);
        mqttHandler.connect();
      } else {
        console.log(`Reusing MQTT handler for broker ${brokerId} for user ${socket.userId}`);
        const mqttHandler = mqttHandlers.get(key);
        mqttHandler.updateSocket(socket);
        if (!mqttHandler.isConnected()) {
          mqttHandler.connect();
        }
      }
    } catch (error) {
      console.error(`Failed to connect broker ${brokerId}: ${error.message}`);
      socket.emit("error", { message: `Failed to connect broker: ${error.message}`, brokerId });
    }
  });

  socket.on("subscribe", ({ brokerId, topic }) => {
    console.log(`Received subscribe request for topic ${topic} on broker ${brokerId} from user ${socket.userId}`);
    const mqttHandler = mqttHandlers.get(`${socket.userId}_${brokerId}`);
    if (mqttHandler && mqttHandler.isConnected()) {
      mqttHandler.subscribe(topic);
    } else {
      console.error(`MQTT handler not found or not connected for broker ${brokerId}`);
      socket.emit("error", { message: "MQTT handler not found or not connected", brokerId });
    }
  });

  socket.on("publish", ({ brokerId, topic, message }) => {
    console.log(`Received publish request for topic ${topic} on broker ${brokerId} from user ${socket.userId}`);
    const mqttHandler = mqttHandlers.get(`${socket.userId}_${brokerId}`);
    if (mqttHandler && mqttHandler.isConnected()) {
      mqttHandler.publish(topic, message);
    } else {
      console.error(`MQTT handler not found or not connected for broker ${brokerId}`);
      socket.emit("error", { message: "MQTT handler not found or not connected", brokerId });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id} for user ${socket.userId}`);
    if (userSockets.get(socket.userId) === socket.id) {
      userSockets.delete(socket.userId);
    }
    setTimeout(() => {
      if (!userSockets.has(socket.userId)) {
        mqttHandlers.forEach((handler, key) => {
          if (key.startsWith(`${socket.userId}_`)) {
            console.log(`Cleaning up MQTT handler for ${key}`);
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