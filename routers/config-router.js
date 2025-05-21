const express = require("express");
const router = express.Router();
const Broker = require("../models/broker-model");
const Configuration = require("../models/configuration-model");
const authMiddleware = require("../middlewares/auth-middleware");

router.post("/configurations", authMiddleware, async (req, res) => {
  try {
    const { configurations, userId, brokerId, topicName } = req.body;

    // Validate payload
    if (!configurations || !Array.isArray(configurations)) {
      return res.status(400).json({ message: "Configurations array is required" });
    }
    if (!userId || userId !== req.userId) {
      return res.status(400).json({ message: "Invalid or missing userId" });
    }
    if (!brokerId) {
      return res.status(400).json({ message: "Broker ID is required" });
    }
    if (!topicName || typeof topicName !== "string" || !topicName.trim()) {
      return res.status(400).json({ message: "Valid topic name is required" });
    }

    // Verify broker exists and belongs to the user
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      return res.status(404).json({ message: "Broker not found" });
    }

    // Save configuration to MongoDB
    const configuration = new Configuration({
      configurations,
      userId,
      brokerId,
      topicName: topicName.trim(),
    });
    await configuration.save();

    res.status(200).json({ message: "Configuration saved successfully", configuration });
  } catch (error) {
    console.error(`Error saving configuration: ${error.message}`);
    res.status(400).json({
      message: "Failed to save configuration",
      error: error.message,
    });
  }
});

module.exports = router;

