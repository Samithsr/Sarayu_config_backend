const express = require("express");
const router = express.Router();
const Broker = require("../models/broker-model");
const User = require("../models/user-model");
const MqttHandler = require("../middlewares/mqtt-handler");
const authMiddleware = require("../middlewares/auth-middleware");
const restrictToadmin = require("../middlewares/restrictToadmin");
const mongoose = require("mongoose");

// Validate broker IP or hostname
const isValidBrokerAddress = (ip) => {
  if (!ip || typeof ip !== "string" || ip.trim() === "") {
    return false;
  }
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/;
  return ip === "localhost" || ipv4Regex.test(ip) || hostnameRegex.test(ip);
};

// Enhanced MQTT error parsing
const parseMqttError = async (error, userId, broker) => {
  const errors = [];
  const user = await User.findById(userId);
  const userEmail = user ? user.email : "Unknown";

  // Handle non-credential-related errors
  if (!error.message.includes("bad user name or password") && !error.message.includes("not authorized")) {
    if (error.message.includes("connection refused")) {
      errors.push("Connection refused by broker. Ensure the broker is running and accessible.");
    } else if (
      error.message.includes("connack timeout") ||
      error.message.includes("timeout") ||
      error.message.includes("ENOTFOUND") ||
      error.message.includes("ECONNREFUSED")
    ) {
      errors.push("Connection Ack timeout");
    } else {
      errors.push("Not atuthrized");
    }
    return errors;
  }

  // Credential error detected: perform two-step test to distinguish username vs password issue
  try {
    // Step 1: Test with the provided username and a wrong password to check if username exists
    const testBrokerUsername = {
      _id: `test_${userId}_${Date.now()}`,
      brokerIp: broker.brokerIp,
      portNumber: broker.portNumber,
      username: broker.username || "",
      password: "intentionally-wrong-password",
    };

    const mqttHandlerUsernameTest = new MqttHandler(userId, testBrokerUsername);
    const usernameTestConnected = await mqttHandlerUsernameTest.testConnection(broker.portNumber);

    if (!usernameTestConnected) {
      const usernameTestError = mqttHandlerUsernameTest.connectionStatus === "disconnected" ? "bad user name or password" : "";
      if (usernameTestError.includes("bad user name or password") || usernameTestError.includes("not authorized")) {
        errors.push("Not authorized");
        return errors;
      }
    }

    // Step 2: If username test didn't fail specifically for credentials, the password is likely the issue
    errors.push("Not authorized");
  } catch (testError) {
    console.error(`[User: ${userId} (${userEmail})] Error during MQTT credential test: ${testError.message}`);
    errors.push("Not authorized");
  }

  console.error(
    `[User: ${userId} (${userEmail})] MQTT error for broker ${broker?._id || "unknown"}: ${errors.join(", ")}`
  );
  return errors;
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
      throw new Error("Invalid broker address");
    }
    if (broker.portNumber < 1 || broker.portNumber > 65535) {
      throw new Error("Invalid port number");
    }

    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";
    console.log(`[User: ${userId} (${userEmail})] Validating broker ${broker._id} with IP ${broker.brokerIp}:${broker.portNumber}`);

    const mqttHandlerTest = new MqttHandler(userId, broker);
    const isBrokerAvailable = await mqttHandlerTest.testConnection(broker.portNumber);
    if (!isBrokerAvailable) {
      const mqttErrors = await parseMqttError(new Error(mqttHandlerTest.connectionError || "Failed to establish MQTT connection"), userId, broker);
      broker.connectionStatus = "disconnected";
      broker.lastValidationError = mqttErrors.join(", ");
      await broker.save();
      console.log(`[User: ${userId} (${userEmail})] Validation failed for broker ${broker._id}`);
      return {
        connected: false,
        connectionStatus: "disconnected",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      };
    }

    console.log(`[User: ${userId} (${userEmail})] Broker ${broker._id} validated successfully`);

    const key = `${userId}_${broker._id}`;
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
    console.log(`[User: ${userId} (${userEmail})] MQTT connection attempt result: ${connected}`);

    if (!connected) {
      const mqttErrors = await parseMqttError(new Error(mqttHandler.connectionError || "Failed to establish MQTT connection"), userId, broker);
      broker.connectionStatus = "disconnected";
      broker.lastValidationError = mqttErrors.join(", ");
      await broker.save();
      console.log(`[User: ${userId} (${userEmail})] Connection failed, status set to disconnected for broker ${broker._id}`);
      return {
        connected: false,
        connectionStatus: "disconnected",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      };
    }

    mqttHandlers.set(key, mqttHandler);
    broker.connectionStatus = "connected";
    broker.connectionTime = new Date();
    broker.lastValidationError = null;
    await broker.save();

    connectedBrokers.set(key, true);
    console.log(`[User: ${userId} (${userEmail})] MQTT client connected for broker ${broker._id}`);
    return { connected: true, connectionStatus: "connected" };
  } catch (error) {
    console.error(`[User: ${userId}] Failed to connect broker ${broker?._id || "unknown"}: ${error.message}`);
    if (broker) {
      broker.connectionStatus = "disconnected";
      const mqttErrors = await parseMqttError(error, userId, broker);
      broker.lastValidationError = mqttErrors.join(", ");
      await broker.save();
    }
    const mqttErrors = await parseMqttError(error, userId, broker);
    return {
      connected: false,
      connectionStatus: "disconnected",
      error: mqttErrors.join(", "),
      validationErrors: mqttErrors,
    };
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
      const mqttErrors = ["Invalid broker address"];
      return res.status(400).json({
        message: "Invalid broker address",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
    }

    if (portNumber < 1 || portNumber > 65535) {
      console.error(`[User: ${userId} (${userEmail})] Invalid port number: ${portNumber}`);
      const mqttErrors = ["Invalid port number"];
      return res.status(400).json({
        message: "Invalid port number",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
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
      console.error(`[User: ${userId} (${userEmail})] Failed to connect to broker ${brokerIp}:${portNumber}`);
      const mqttErrors = await parseMqttError(new Error(mqttHandler.connectionError || "Failed to establish MQTT connection"), userId, testBroker);
      return res.status(400).json({
        message: "Broker is not available",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
    }

    console.log(`[User: ${userId} (${userEmail})] Test connection successful for ${brokerIp}:${portNumber}`);
    res.status(200).json({ message: "Broker is available" });
  } catch (error) {
    const user = await User.findById(req.userId);
    const userEmail = user ? user.email : "Unknown";
    console.error(`[User: ${req.userId} (${userEmail})] Error testing broker: ${error.message}`);
    const testBroker = {
      brokerIp: req.body.brokerIp,
      portNumber: req.body.portNumber,
      username: req.body.username || "",
      password: req.body.password || "",
    };
    const mqttErrors = await parseMqttError(error, req.userId, testBroker);
    res.status(500).json({
      message: "Failed to test broker connection",
      error: mqttErrors.join(", "),
      validationErrors: mqttErrors,
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
        error: result.error,
        validationErrors: result.validationErrors,
      });
    }

    res.status(200).json({
      message: "Broker connected successfully",
      connectionStatus: "connected",
    });
  } catch (error) {
    const broker = await Broker.findById(req.params.brokerId);
    console.error(`[User: ${req.userId}] Error connecting to broker ${req.params.brokerId}: ${error.message}`);
    const mqttErrors = await parseMqttError(error, req.userId, broker || {});
    res.status(500).json({
      message: "Failed to connect to broker",
      connectionStatus: "disconnected",
      error: mqttErrors.join(", "),
      validationErrors: mqttErrors,
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
        return res.status(500).json({
          message: "Failed to auto-connect broker",
          error: result.error,
          validationErrors: result.validationErrors,
        });
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
router.post("/brokers/:brokerId/assign-user", authMiddleware, restrictToadmin("admin"), async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { userId } = req.body;
    console.log(`[Admin: ${req.userId}] Assigning user ${userId || "none"} to broker ${brokerId}`);

    const broker = await Broker.findById(brokerId);
    if (!broker) {
      console.error(`[Admin: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    if (userId === null || userId === "") {
      broker.assignedUserId = null;
      await broker.save();
      console.log(`[Admin: ${req.userId}] User unassigned from broker ${brokerId} successfully`);
      return res.status(200).json({
        message: "User unassigned from broker successfully",
        broker: {
          ...broker.toObject(),
          assignedUserId: null,
          assignedUserEmail: null,
        },
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error(`[Admin: ${req.userId}] Invalid user ID format: ${userId}`);
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error(`[Admin: ${req.userId}] User ${userId} not found in database`);
      return res.status(404).json({ message: "User not found" });
    }

    if (user.roles === "admin") {
      console.error(`[Admin: ${req.userId}] Cannot assign admin user ${userId} to broker`);
      return res.status(403).json({ message: "Cannot assign admin users to brokers" });
    }

    broker.assignedUserId = userId;
    await broker.save();

    console.log(`[Admin: ${req.userId}] User ${userId} (${user.email}) assigned to broker ${brokerId} successfully`);
    res.status(200).json({
      message: "User assigned to broker successfully",
      broker: {
        ...broker.toObject(),
        assignedUserId: userId,
        assignedUserEmail: user.email,
      },
    });
  } catch (error) {
    console.error(`[Admin: ${req.userId}] Error assigning user to broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to assign user to broker",
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

    if (user.roles === "admin") {
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
        return res.status(500).json({
          message: "Failed to initialize MQTT connection",
          error: result.error,
          validationErrors: result.validationErrors,
        });
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

// Create broker
router.post("/brokers", authMiddleware, restrictToadmin("admin"), async (req, res) => {
  try {
    const { brokerIp, portNumber, username, password, label } = req.body;
    console.log(`[User: ${req.userId}] Creating broker ${brokerIp}:${portNumber}`);

    if (!brokerIp || !portNumber) {
      console.error(`[User: ${req.userId}] Missing broker IP or port`);
      return res.status(400).json({ message: "Broker IP and port are required" });
    }

    if (!isValidBrokerAddress(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid broker address: ${brokerIp}`);
      const mqttErrors = ["Invalid broker address"];
      return res.status(400).json({
        message: "Invalid broker address",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
    }

    if (portNumber < 1 || portNumber > 65535) {
      console.error(`[User: ${req.userId}] Invalid port number: ${portNumber}`);
      const mqttErrors = ["Invalid port number"];
      return res.status(400).json({
        message: "Invalid port number",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
    }

    const broker = new Broker({
      brokerIp,
      portNumber,
      username: username || "",
      password: password || "",
      label: label || "Unnamed Broker",
      userId: req.userId,
      connectionStatus: "disconnected",
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
    const brokers = await Broker.find({ }).populate("assignedUserId", "email");
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
router.put("/brokers/:brokerId", authMiddleware, restrictToadmin("admin"), async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { brokerIp, portNumber, username, password, label } = req.body;
    console.log(`[User: ${req.userId}] Updating broker ${brokerId}`);

    if (!brokerIp || !portNumber) {
      console.error(`[User: ${req.userId}] Missing broker IP or port for broker ${brokerId}`);
      return res.status(400).json({ message: "Broker IP and port are required" });
    }

    if (!isValidBrokerAddress(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid broker address: ${brokerIp}`);
      const mqttErrors = ["Invalid broker address"];
      return res.status(400).json({
        message: "Invalid broker address",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
    }

    if (portNumber < 1 || portNumber > 65535) {
      console.error(`[User: ${req.userId}] Invalid port number: ${portNumber}`);
      const mqttErrors = ["Invalid port number"];
      return res.status(400).json({
        message: "Invalid port number",
        error: mqttErrors.join(", "),
        validationErrors: mqttErrors,
      });
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
    broker.label = label || "Unnamed Broker";
    broker.connectionStatus = "disconnected";

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
router.delete("/brokers/:brokerId", authMiddleware, restrictToadmin("admin"), async (req, res) => {
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
        return res.status(500).json({
          message: "Failed to initialize MQTT connection",
          error: result.error,
          validationErrors: result.validationErrors,
        });
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
router.post("/brokers/:brokerId/disconnect", authMiddleware, restrictToadmin("admin"), async (req, res) => {
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

// Disconnect all brokers for the user
router.post("/brokers/disconnect-all", authMiddleware, restrictToadmin("admin"), async (req, res) => {
  try {
    const userId = req.userId;
    console.log(`[User: ${userId}] Disconnecting all brokers`);

    const brokers = await Broker.find({ userId });
    if (!brokers || brokers.length === 0) {
      console.log(`[User: ${userId}] No brokers found`);
      return res.status(200).json({ message: "No brokers to disconnect" });
    }

    for (const broker of brokers) {
      const key = `${userId}_${broker._id}`;
      const mqttHandler = req.mqttHandlers.get(key);
      if (mqttHandler) {
        mqttHandler.disconnect();
        req.mqttHandlers.delete(key);
        req.connectedBrokers.delete(key);
        console.log(`[User: ${userId}] Disconnected and removed MQTT handler for ${key}`);
      }
      broker.connectionStatus = "disconnected";
      await broker.save();
      console.log(`[User: ${userId}] Broker ${broker._id} disconnected successfully`);
    }
    // const result = await Broker.updateMany({},{$set : {assignedUserId : ""}})
    //   console.log(result)

    res.status(200).json({ message: "All brokers disconnected successfully" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error disconnecting all brokers: ${error.message}`);
    res.status(500).json({
      message: "Failed to disconnect all brokers",
      error: error.message,
    });
  }
});

// Clear assigned users on logout
router.post("/auth/logout", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    const userEmail = user ? user.email : "Unknown";
    console.log(`[User: ${userId} (${userEmail})] Logging out and clearing assigned brokers`);

    const brokers = await Broker.find({ assignedUserId: userId });
    if (brokers.length > 0) {
      for (const broker of brokers) {
        broker.assignedUserId = null;
        await broker.save();
        console.log(`[User: ${userId} (${userEmail})] Cleared assigned user for broker ${broker._id}`);
      }
    } else {
      console.log(`[User: ${userId} (${userEmail})] No brokers assigned to user`);
    }

    const keys = Array.from(req.mqttHandlers.keys()).filter((key) => key.startsWith(`${userId}_`));
    for (const key of keys) {
      const mqttHandler = req.mqttHandlers.get(key);
      if (mqttHandler) {
        mqttHandler.disconnect();
        req.mqttHandlers.delete(key);
        req.connectedBrokers.delete(key);
        console.log(`[User: ${userId} (${userEmail})] Disconnected MQTT handler for ${key}`);
      }
    }
      
    res.status(200).json({ message: "Logged out successfully, assigned brokers cleared" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error during logout: ${error.message}`);
    res.status(500).json({
      message: "Failed to logout",
      error: error.message,
    });
  }
});

module.exports = router;