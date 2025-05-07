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

router.post("/test-broker", auth, async (req, res) => {
  try {
    const { brokerIp, portNumber = 1883, username, password } = req.body;
    if (!brokerIp) {
      return res.status(400).json({ message: "Broker IP is required" });
    }

    // Test MQTT connection
    const mqttHandler = new MqttHandler(null, req.userId, {
      brokerIp,
      username,
      password,
      _id: "test",
    });
    const isAvailable = await mqttHandler.testConnection(portNumber);
    if (!isAvailable) {
      return res.status(400).json({ message: "Broker is not available" });
    }

    res.status(200).json({ message: "Broker is available" });
  } catch (error) {
    console.error(`Error testing broker: ${error.message}`);
    res.status(400).json({
      message: "Failed to test broker",
      error: error.message,
    });
  }
});

router.post("/brokers", auth, async (req, res) => {
  try {
    const { brokerIp, username, password, label } = req.body;
    if (!brokerIp) {
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!label) {
      return res.status(400).json({ message: "Label is required" });
    }
    const existingBroker = await Broker.findOne({
      brokerIp,
      userId: req.userId,
    });
    if (existingBroker) {
      return res.status(400).json({ message: "Broker with this IP already exists" });
    }
    const broker = new Broker({
      brokerIp,
      username,
      password,
      label,
      userId: req.userId,
    });
    await broker.save();

    // Emit connect_broker event to initiate MQTT connection
    req.io.to(req.userId).emit("connect_broker", { brokerId: broker._id });

    res.status(201).json(broker);
  } catch (error) {
    console.error(`Error creating broker: ${error.message}`);
    res.status(400).json({
      message: "Failed to create broker",
      error: error.message,
    });
  }
});

router.get("/brokers", auth, async (req, res) => {
  try {
    const brokers = await Broker.find({ userId: req.userId });
    res.status(200).json(brokers);
  } catch (error) {
    console.error(`Error fetching brokers: ${error.message}`);
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
    if (!topic) {
      return res.status(400).json({ message: "Topic is required" });
    }
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      return res.status(404).json({ message: "Broker not found" });
    }

    // Emit subscribe event to the user's socket
    req.io.to(req.userId).emit("subscribe", { brokerId, topic });

    res.status(200).json({ message: `Subscription request for topic ${topic} received`, brokerId });
  } catch (error) {
    console.error(`Error processing subscription: ${error.message}`);
    res.status(400).json({
      message: "Failed to process subscription",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/connect", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      return res.status(404).json({ message: "Broker not found" });
    }

    // Emit connect_broker event to initiate MQTT connection
    req.io.to(req.userId).emit("connect_broker", { brokerId });

    res.status(200).json({ message: `Connection request for broker ${brokerId} received` });
  } catch (error) {
    console.error(`Error processing connection request: ${error.message}`);
    res.status(400).json({
      message: "Failed to process connection request",
      error: error.message,
    });
  }
});

module.exports = router;