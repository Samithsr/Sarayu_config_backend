const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Broker = require("../models/broker-model");
const MqttHandler = require("../middlewares/mqtt-handler");

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    req.userId = decoded._id;
    next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};

// Validate IPv4 address
const isValidIPv4 = (ip) => {
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
};

router.post("/test-broker", auth, async (req, res) => {
  try {
    const { brokerIp, portNumber = 1883, username, password } = req.body;
    console.log(`Testing broker availability for IP ${brokerIp}:${portNumber} for user ${req.userId}`);
    if (!brokerIp) {
      console.error(`Broker IP missing for user ${req.userId}`);
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!isValidIPv4(brokerIp)) {
      console.error(`Invalid IP address ${brokerIp} for user ${req.userId}`);
      return res.status(400).json({ message: "Invalid IP address format" });
    }

    const mqttHandler = new MqttHandler(null, req.userId, {
      brokerIp,
      username,
      password,
      _id: "test",
    });
    const isAvailable = await mqttHandler.testConnection(portNumber);
    if (!isAvailable) {
      console.error(`Broker ${brokerIp}:${portNumber} is not available for user ${req.userId}`);
      return res.status(400).json({ message: "Broker is not available" });
    }

    console.log(`Broker ${brokerIp}:${portNumber} is available for user ${req.userId}`);
    res.status(200).json({ message: "Broker is available" });
  } catch (error) {
    console.error(`Error testing broker for user ${req.userId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to test broker",
      error: error.message,
    });
  }
});

router.post("/brokers", auth, async (req, res) => {
  try {
    const { brokerIp, username, password, label, portNumber = 1883 } = req.body;
    console.log(`Creating broker for user ${req.userId} with IP ${brokerIp}:${portNumber}, label: ${label}`);
    if (!brokerIp) {
      console.error(`Broker IP missing for user ${req.userId}`);
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!isValidIPv4(brokerIp)) {
      console.error(`Invalid IP address ${brokerIp} for user ${req.userId}`);
      return res.status(400).json({ message: "Invalid IP address format" });
    }
    if (!label) {
      console.error(`Label missing for user ${req.userId}`);
      return res.status(400).json({ message: "Label is required" });
    }
    const existingBroker = await Broker.findOne({
      brokerIp,
      userId: req.userId,
    });
    if (existingBroker) {
      console.error(`Broker with IP ${brokerIp} already exists for user ${req.userId}`);
      return res.status(400).json({ message: "Broker with this IP already exists" });
    }
    const broker = new Broker({
      brokerIp,
      portNumber,
      username,
      password,
      label,
      userId: req.userId,
      connectionStatus: "connecting",
    });
    await broker.save();
    console.log(`Broker ${broker._id} created for user ${req.userId}`);

    // Initialize MQTT connection
    const key = `${req.userId}_${broker._id}`;
    console.log(`Initializing MQTT handler for broker ${broker._id} for user ${req.userId}`);
    const mqttHandler = new MqttHandler(null, req.userId, broker);
    req.mqttHandlers.set(key, mqttHandler);
    mqttHandler.connect();

    // Listen for MQTT connection status to update broker in DB
    mqttHandler.client?.on("connect", async () => {
      try {
        await Broker.updateOne(
          { _id: broker._id, userId: req.userId },
          { connectionStatus: "connected" }
        );
        console.log(`Broker ${broker._id} status updated to connected for user ${req.userId}`);
        req.io.to(req.userId).emit("mqtt_status", { brokerId: broker._id, status: "connected" });
      } catch (error) {
        console.error(`Error updating broker ${broker._id} status for user ${req.userId}: ${error.message}`);
      }
    });

    mqttHandler.client?.on("error", async (err) => {
      try {
        await Broker.updateOne(
          { _id: broker._id, userId: req.userId },
          { connectionStatus: "error" }
        );
        console.error(`Broker ${broker._id} error for user ${req.userId}: ${err.message}`);
        req.io.to(req.userId).emit("mqtt_status", { brokerId: broker._id, status: "error" });
      } catch (error) {
        console.error(`Error updating broker ${broker._id} status for user ${req.userId}: ${error.message}`);
      }
    });

    mqttHandler.client?.on("close", async () => {
      try {
        await Broker.updateOne(
          { _id: broker._id, userId: req.userId },
          { connectionStatus: "disconnected" }
        );
        console.log(`Broker ${broker._id} disconnected for user ${req.userId}`);
        req.io.to(req.userId).emit("mqtt_status", { brokerId: broker._id, status: "disconnected" });
      } catch (error) {
        console.error(`Error updating broker ${broker._id} status for user ${req.userId}: ${error.message}`);
      }
    });

    console.log(`Emitting connect_broker event for broker ${broker._id} to user ${req.userId}`);
    req.io.to(req.userId).emit("connect_broker", { brokerId: broker._id });

    res.status(201).json(broker);
  } catch (error) {
    console.error(`Error creating broker for user ${req.userId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to create broker",
      error: error.message,
    });
  }
});

router.get("/brokers", auth, async (req, res) => {
  try {
    console.log(`Fetching brokers for user ${req.userId}`);
    const brokers = await Broker.find({ userId: req.userId });
    console.log(`Found ${brokers.length} brokers for user ${req.userId}`);
    res.status(200).json(brokers);
  } catch (error) {
    console.error(`Error fetching brokers for user ${req.userId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to fetch brokers",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/subscribe", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { topic } = req.body;
    console.log(`Processing subscription for topic ${topic} on broker ${brokerId} for user ${req.userId}`);
    if (!topic) {
      console.error(`Topic missing for subscription on broker ${brokerId} for user ${req.userId}`);
      return res.status(400).json({ message: "Topic is required" });
    }
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`Broker ${brokerId} not found for user ${req.userId}`);
      return res.status(404).json({ message: "Broker not found" });
    }

    console.log(`Emitting subscribe event for topic ${topic} on broker ${brokerId} to user ${req.userId}`);
    req.io.to(req.userId).emit("subscribe", { brokerId, topic });

    res.status(200).json({ message: `Subscription request for topic ${topic} received`, brokerId });
  } catch (error) {
    console.error(`Error processing subscription for user ${req.userId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to process subscription",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/connect", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`Processing connection request for broker ${brokerId} for user ${req.userId}`);
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`Broker ${brokerId} not found for user ${req.userId}`);
      return res.status(404).json({ message: "Broker not found" });
    }

    console.log(`Emitting connect_broker event for broker ${brokerId} to user ${req.userId}`);
    req.io.to(req.userId).emit("connect_broker", { brokerId });

    res.status(200).json({ message: `Connection request for broker ${brokerId} received` });
  } catch (error) {
    console.error(`Error processing connection request for user ${req.userId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to process connection request",
      error: error.message,
    });
  }
});

module.exports = router;