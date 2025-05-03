const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Broker = require("../models/broker-model");

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
    const { brokerIp,  username, password, label } = req.body;
    const existingBroker = await Broker.findOne({
      brokerIp,
      userId: req.userId,
    });
    if (existingBroker) {
      return res.status(400).json({ message: "Broker with this IP and port already exists" });
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

module.exports = router;