const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRouter = require("./routers/auth-router");
const brokerRouter = require("./routers/broker-router");
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

// Socket.IO Authentication Middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token?.split(" ")[1];
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    socket.userId = decoded._id;
    next();
  } catch (error) {
    next(new Error("Authentication error: Invalid token"));
  }
});

// MQTT Client Management
const mqttHandlers = new Map(); // Store MQTT handlers per user and broker

io.on("connection", async (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Handle topic subscription from client
  socket.on("subscribe", ({ brokerId, topic }) => {
    const mqttHandler = mqttHandlers.get(`${socket.userId}_${brokerId}`);
    if (mqttHandler) {
      mqttHandler.subscribe(topic);
    } else {
      socket.emit("error", { message: "MQTT handler not found", brokerId });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    // Clean up MQTT handlers for this user
    mqttHandlers.forEach((handler, key) => {
      if (key.startsWith(`${socket.userId}_`)) {
        handler.disconnect();
        mqttHandlers.delete(key);
      }
    });
  });
});

// MongoDB Connection
mongoose
  .connect("mongodb://localhost:27017/gateway")
  .then(async () => {
    console.log("Database connection successful!");
    server.listen(5000, () => {
      console.log("Listening on port 5000");
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
  });