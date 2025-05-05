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

router.post("/brokers", auth, async (req, res) => {
  try {
    const { brokerIp, username, password, label } = req.body;
    if (!brokerIp) {
      return res.status(400).json({ message: "Broker IP is required" });
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
    res.status(201).json(broker);
  } catch (error) {
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
    res.status(200).json({ message: `Subscription request for topic ${topic} received`, brokerId });
  } catch (error) {
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
    res.status(200).json({ message: `Connection request for broker ${brokerId} received` });
  } catch (error) {
    res.status(400).json({
      message: "Failed to process connection request",
      error: error.message,
    });
  }
});

module.exports = router;