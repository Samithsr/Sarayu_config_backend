const express = require("express");
const router = express.Router();
const Broker = require("../models/broker-model");
const User = require("../models/user-model");
const MqttHandler = require("../middlewares/mqtt-handler");
const authMiddleware = require("../middlewares/auth-middleware");
const restrictToadmin = require("../middlewares/restrictToadmin");
const mongoose = require("mongoose");

const isValidBrokerAddress = (ip) => {
  if (ip === "localhost" || ip === "127.0.0.1") {
    return true;
  }
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
};

// Reusable connect broker logic
const connectBroker = async (broker, userId, mqttHandlers, connectedBrokers) => {
  try {
    if (!userId) {
      throw new Error("User ID is missing");
    }
    if (!broker || !broker._id || !broker.brokerIp || !broker.portNumber) {
      console.error(`[User: ${userId}] Invalid broker data: ${JSON.stringify(broker)}`);
      throw new Error("Invalid or missing broker data");
    }
    if (!isValidBrokerAddress(broker.brokerIp)) {
      throw new Error(`Invalid broker address: ${broker.brokerIp}`);
    }

    const key = `${userId}_${broker._id}`;
    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";

    console.log(`[User: ${userId} (${userEmail})] Connecting broker ${broker._id} with IP ${broker.brokerIp}:${broker.portNumber}`);

    if (mqttHandlers.has(key)) {
      const existingHandler = mqttHandlers.get(key);
      if (existingHandler.isConnected()) {
        console.log(`[User: ${userId} (${userEmail})] MQTT handler already connected for ${key}`);
        return { connected: true, connectionStatus: "connected" };
      } else {
        console.log(`[User: ${userId} (${userEmail})] Removing stale MQTT handler for ${key}`);
        existingHandler.disconnect();
        mqttHandlers.delete(key);
        connectedBrokers.delete(key);
      }
    }

    const mqttHandler = new MqttHandler(userId, broker);
    const connected = await mqttHandler.connect();
    if (!connected) {
      broker.connectionStatus = "disconnected";
      await broker.save();
      throw new Error("Failed to establish MQTT connection");
    }
    mqttHandlers.set(key, mqttHandler);
    broker.connectionStatus = "connected";
    await broker.save();

    connectedBrokers.set(key, true);
    console.log(`[User: ${userId} (${userEmail})] MQTT client connected for broker ${broker._id}`);
    return { connected: true, connectionStatus: "connected" };
  } catch (error) {
    console.error(`[User: ${userId}] Failed to connect broker ${broker?._id || 'unknown'}: ${error.message}`);
    if (broker) {
      broker.connectionStatus = "disconnected";
      await broker.save();
    }
    return { connected: false, connectionStatus: "disconnected", error: error.message };
  }
};

// Test broker availability
router.post("/test-broker", authMiddleware, async (req, res) => {
  try {
    const { brokerIp, portNumber, username, password } = req.body;
    const userId = req.userId;
    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";

    console.log(`[User: ${userId} (${userEmail})] Testing broker ${brokerIp}:${portNumber}`);

    if (!brokerIp || !portNumber) {
      console.error(`[User: ${userId} (${userEmail})] Missing broker IP or port`);
      return res.status(400).json({ message: "Broker IP and port are required" });
    }

    if (!isValidBrokerAddress(brokerIp)) {
      console.error(`[User: ${userId} (${userEmail})] Invalid broker address: ${brokerIp}`);
      return res.status(400).json({ message: "Invalid broker address" });
    }

    if (portNumber < 1 || portNumber > 65535) {
      console.error(`[User: ${userId} (${userEmail})] Invalid port number: ${portNumber}`);
      return res.status(400).json({ message: "Port must be between 1 and 65535" });
    }

    const testBroker = {
      _id: `test_${userId}_${Date.now()}`,
      brokerIp,
      portNumber,
      username: username || "",
      password: password || "",
    };

    const mqttHandler = new MqttHandler(userId, testBroker);
    const connected = await mqttHandler.testConnection(portNumber);

    if (!connected) {
      console.error(`[User: ${userId} (${userEmail})] Failed to connect to test broker ${brokerIp}:${portNumber}`);
      return res.status(400).json({ message: "Broker is not available" });
    }

    console.log(`[User: ${userId} (${userEmail})] Test connection successful for ${brokerIp}:${portNumber}`);
    res.status(200).json({ message: "Broker is available" });
  } catch (error) {
    const user = await User.findById(req.userId);
    const userEmail = user ? user.email : "Unknown";
    console.error(`[User: ${req.userId} (${userEmail})] Error testing broker: ${error.message}`);
    res.status(500).json({
      message: "Failed to test broker connection",
      error: error.message,
    });
  }
});

// Get broker status
router.get("/brokers/:brokerId/status", authMiddleware, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const userId = req.userId;
    console.log(`[User: ${userId}] Checking status for broker ${brokerId}`);

    const broker = await Broker.findOne({ _id: brokerId, assignedUserId: userId });
    if (!broker) {
      console.error(`[User: ${userId}] Broker ${brokerId} not found or not assigned to user`);
      return res.status(404).json({ message: "Broker not found or not assigned to you" });
    }

    const key = `${userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    const status = mqttHandler && mqttHandler.isConnected() ? "connected" : broker.connectionStatus;

    console.log(`[User: ${userId}] Broker ${brokerId} status: ${status}`);
    res.status(200).json({ connectionStatus: status });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error fetching broker status: ${error.message}`);
    res.status(500).json({
      message: "Failed to fetch broker status",
      error: error.message,
    });
  }
});

// Check if user is assigned to any broker and auto-connect
router.get("/brokers/assigned", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    console.log(`[User: ${userId}] Checking assigned brokers`);

    const user = await User.findById(userId);
    if (!user) {
      console.error(`[User: ${userId}] User not found`);
      return res.status(404).json({ message: "User not found" });
    }

    if (user.roles === "admin") {
      console.log(`[User: ${userId}] Admin cannot be assigned to brokers`);
      return res.status(403).json({ message: "Admins cannot be assigned to brokers" });
    }

    const broker = await Broker.findOne({ assignedUserId: userId });
    if (!broker) {
      console.log(`[User: ${userId}] No brokers assigned`);
      return res.status(403).json({ message: "No brokers assigned to this user" });
    }

    if (broker.connectionStatus !== "connected") {
      console.log(`[User: ${userId}] Auto-connecting broker ${broker._id}`);
      const result = await connectBroker(broker, userId, req.mqttHandlers, req.connectedBrokers);
      if (!result.connected) {
        return res.status(500).json({ message: "Failed to auto-connect broker", error: result.error });
      }
    }

    console.log(`[User: ${userId}] Found assigned broker ${broker._id}, status: ${broker.connectionStatus}`);
    res.status(200).json({ 
      brokerId: broker._id,
      connectionStatus: broker.connectionStatus,
    });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error checking assigned brokers: ${error.message}`);
    res.status(500).json({
      message: "Failed to check assigned brokers",
      error: error.message,
    });
  }
});

// Assign user to broker
router.post('/brokers/:brokerId/assign-user', authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { userId } = req.body;
    console.log(`[Admin: ${req.userId}] Assigning user ${userId} to broker ${brokerId}`);

    if (!userId) {
      console.error(`[Admin: ${req.userId}] User ID missing for broker ${brokerId}`);
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error(`[Admin: ${req.userId}] Invalid user ID format: ${userId}`);
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    const broker = await Broker.findById(brokerId);
    if (!broker) {
      console.error(`[Admin: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: 'Broker not found' });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error(`[Admin: ${req.userId}] User ${userId} not found in database`);
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.roles === 'admin') {
      console.error(`[Admin: ${req.userId}] Cannot assign admin user ${userId} to broker`);
      return res.status(403).json({ message: 'Cannot assign admin users to brokers' });
    }

    broker.assignedUserId = userId;
    await broker.save();

    console.log(`[Admin: ${req.userId}] User ${userId} (${user.email}) assigned to broker ${brokerId} successfully`);
    res.status(200).json({ 
      message: 'User assigned to broker successfully', 
      broker: {
        ...broker.toObject(),
        assignedUserId: userId,
        assignedUserEmail: user.email
      }
    });
  } catch (error) {
    console.error(`[Admin: ${req.userId}] Error assigning user to broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: 'Failed to assign user to broker',
      error: error.message,
    });
  }
});

// Publish message
router.post("/brokers/:brokerId/publish", authMiddleware, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { topic, message } = req.body;
    const userId = req.userId;
    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";
    console.log(`[User: ${userId} (${userEmail})] Processing publish request for topic ${topic} on broker ${brokerId}`);

    if (!topic || !message) {
      console.error(`[User: ${userId} (${userEmail})] Topic or message missing for publish on broker ${brokerId}`);
      return res.status(400).json({ message: "Topic and message are required" });
    }

    const broker = await Broker.findOne({ _id: brokerId, assignedUserId: userId });
    if (!broker) {
      console.error(`[User: ${userId} (${userEmail})] Broker ${brokerId} not found or not assigned to user`);
      return res.status(404).json({ message: "Broker not found or you are not assigned to this broker" });
    }

    console.log(`[User: ${userId} (${userEmail})] Broker details: ID=${broker._id}, IP=${broker.brokerIp}, Port=${broker.portNumber}`);

    if (user.roles === 'admin') {
      console.error(`[User: ${userId} (${userEmail})] Admins are not allowed to publish`);
      return res.status(403).json({ message: "Admins are not allowed to publish" });
    }

    const key = `${userId}_${brokerId}`;
    let mqttHandler = req.mqttHandlers.get(key);

    if (!mqttHandler || !mqttHandler.isConnected()) {
      console.log(`[User: ${userId} (${userEmail})] Initializing or reconnecting MQTT handler for ${key}`);
      const result = await connectBroker(broker, userId, req.mqttHandlers, req.connectedBrokers);
      if (!result.connected) {
        console.error(`[User: ${userId} (${userEmail})] Failed to initialize MQTT handler for ${key}`);
        return res.status(500).json({ message: "Failed to initialize MQTT connection", error: result.error });
      }
      mqttHandler = req.mqttHandlers.get(key);
    }

    if (!mqttHandler.isConnected()) {
      console.error(`[User: ${userId} (${userEmail})] MQTT handler not connected for ${key}`);
      return res.status(500).json({ message: "MQTT client is not connected" });
    }

    mqttHandler.publish(topic, message);
    console.log(`[User: ${userId} (${userEmail})] Published to topic ${topic} on broker ${brokerId}`);
    res.status(200).json({ message: `Published to topic ${topic}`, brokerId });
  } catch (error) {
    const user = await User.findById(req.userId);
    const userEmail = user ? user.email : "Unknown";
    console.error(`[User: ${req.userId} (${userEmail})] Error processing publish: ${error.message}`);
    res.status(500).json({
      message: "Failed to publish message",
      error: error.message,
    });
  }
});

// Connect broker (restricted to admins)
router.post("/brokers/:brokerId/connect", authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Connecting to broker ${brokerId}`);

    const broker = await Broker.findById(brokerId);
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const result = await connectBroker(broker, req.userId, req.mqttHandlers, req.connectedBrokers);
    if (!result.connected) {
      return res.status(500).json({ 
        message: "Failed to connect to broker", 
        connectionStatus: "disconnected",
        error: result.error 
      });
    }

    res.status(200).json({ 
      message: "Broker connected successfully", 
      connectionStatus: "connected" 
    });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error connecting to broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to connect to broker",
      connectionStatus: "disconnected",
      error: error.message,
    });
  }
});

// Create broker
router.post("/brokers", authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerIp, portNumber, username, password, label } = req.body;
    console.log(`[User: ${req.userId}] Creating broker ${brokerIp}:${portNumber}`);

    if (!brokerIp || !portNumber || !label) {
      console.error(`[User: ${req.userId}] Missing required fields`);
      return res.status(400).json({ message: "Broker IP, port, and label are required" });
    }

    if (!isValidBrokerAddress(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid broker address: ${brokerIp}`);
      return res.status(400).json({ message: "Invalid broker address" });
    }

    const broker = new Broker({
      brokerIp,
      portNumber,
      username: username || "",
      password: password || "",
      label,
      userId: req.userId,
      connectionStatus: "disconnected", // Explicitly set
    });

    await broker.save();
    console.log(`[User: ${req.userId}] Broker ${broker._id} created successfully`);
    res.status(201).json(broker);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error creating broker: ${error.message}`);
    res.status(400).json({
      message: "Failed to create broker",
      error: error.message,
    });
  }
});

// Get all brokers
router.get("/brokers", authMiddleware, async (req, res) => {
  try {
    console.log(`[User: ${req.userId}] Fetching brokers`);
    const brokers = await Broker.find({ userId: req.userId }).populate('assignedUserId', 'email');
    res.status(200).json(brokers);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error fetching brokers: ${error.message}`);
    res.status(500).json({
      message: "Failed to fetch brokers",
      error: error.message,
    });
  }
});

// Update broker
router.put("/brokers/:brokerId", authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { brokerIp, portNumber, username, password, label } = req.body;
    console.log(`[User: ${req.userId}] Updating broker ${brokerId}`);

    if (!brokerIp || !portNumber || !label) {
      console.error(`[User: ${req.userId}] Missing required fields for broker ${brokerId}`);
      return res.status(400).json({ message: "Broker IP, port, and label are required" });
    }

    if (!isValidBrokerAddress(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid broker address: ${brokerIp}`);
      return res.status(400).json({ message: "Invalid broker address" });
    }

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found or not owned by user`);
      return res.status(404).json({ message: "Broker not found or you lack permission" });
    }

    broker.brokerIp = brokerIp;
    broker.portNumber = portNumber;
    broker.username = username || "";
    broker.password = password || "";
    broker.label = label;
    broker.connectionStatus = "disconnected"; // Reset on update

    await broker.save();
    console.log(`[User: ${req.userId}] Broker ${brokerId} updated successfully`);
    res.status(200).json(broker);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error updating broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to update broker",
      error: error.message,
    });
  }
});

// Delete broker
router.delete("/brokers/:brokerId", authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Deleting broker ${brokerId}`);

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found or not owned by user`);
      return res.status(404).json({ message: "Broker not found or you lack permission" });
    }

    await broker.deleteOne();
    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (mqttHandler) {
      mqttHandler.disconnect();
      req.mqttHandlers.delete(key);
      req.connectedBrokers.delete(key);
    }

    console.log(`[User: ${req.userId}] Broker ${brokerId} deleted successfully`);
    res.status(200).json({ message: "Broker deleted successfully" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error deleting broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to delete broker",
      error: error.message,
    });
  }
});

// Subscribe to topic
router.post("/brokers/:brokerId/subscribe", authMiddleware, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { topic } = req.body;
    const userId = req.userId;
    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";
    console.log(`[User: ${userId} (${userEmail})] Subscribing to topic ${topic} on broker ${brokerId}`);

    if (!topic) {
      console.error(`[User: ${userId} (${userEmail})] Topic missing for subscription on broker ${brokerId}`);
      return res.status(400).json({ message: "Topic is required" });
    }

    const broker = await Broker.findOne({ _id: brokerId });
    if (!broker) {
      console.error(`[User: ${userId} (${userEmail})] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    let mqttHandler = req.mqttHandlers.get(key);

    if (!mqttHandler || !mqttHandler.isConnected()) {
      console.log(`[User: ${userId} (${userEmail})] Initializing or reconnecting MQTT handler for ${key}`);
      const result = await connectBroker(broker, userId, req.mqttHandlers, req.connectedBrokers);
      if (!result.connected) {
        console.error(`[User: ${userId} (${userEmail})] Failed to initialize MQTT handler for ${key}`);
        return res.status(500).json({ message: "Failed to initialize MQTT connection", error: result.error });
      }
      mqttHandler = req.mqttHandlers.get(key);
    }

    mqttHandler.subscribe(topic);
    console.log(`[User: ${userId} (${userEmail})] Subscribed to topic ${topic} on broker ${brokerId}`);
    res.status(200).json({ message: `Subscribed to topic ${topic}`, brokerId });
  } catch (error) {
    const user = await User.findById(req.userId);
    const userEmail = user ? user.email : "Unknown";
    console.error(`[User: ${req.userId} (${userEmail})] Error subscribing to topic: ${error.message}`);
    res.status(500).json({
      message: "Failed to subscribe to topic",
      error: error.message,
    });
  }
});

// Disconnect from broker
router.post("/brokers/:brokerId/disconnect", authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Disconnecting from broker ${brokerId}`);

    const broker = await Broker.findById(brokerId);
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (mqttHandler) {
      mqttHandler.disconnect();
      req.mqttHandlers.delete(key);
      req.connectedBrokers.delete(key);
      console.log(`[User: ${req.userId}] MQTT handler disconnected and removed for ${key}`);
    }

    broker.connectionStatus = "disconnected";
    await broker.save();

    console.log(`[User: ${req.userId}] Broker ${brokerId} disconnected successfully`);
    res.status(200).json({ message: "Broker disconnected successfully", connectionStatus: "disconnected" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error disconnecting from broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to disconnect from broker",
      error: error.message,
    });
  }
});

module.exports = router;