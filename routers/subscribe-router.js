const express = require("express");
const mqtt = require("mqtt");
const router = express.Router();

// In-memory message store (use MongoDB for production)
let messages = [];

router.post("/subscribe", async (req, res) => {
  console.log("Received request at /api/subscribe:", req.body);

  try {
    const { inputSets } = req.body;
    const { mqttHandlers, connectedBrokers } = req;

    if (!Array.isArray(inputSets) || inputSets.length === 0) {
      console.error("Invalid or empty inputSets:", inputSets);
      return res.status(400).json({ error: "Invalid or empty inputSets" });
    }

    console.log("Available mqttHandlers:", Array.from(mqttHandlers.keys()));
    console.log("Available connectedBrokers:", Array.from(connectedBrokers.keys()));

    const mqttClient = Array.from(mqttHandlers.values())[0] || Array.from(connectedBrokers.values())[0]?.client;

    if (!mqttClient) {
      console.error("No MQTT client available");
      return res.status(503).json({ error: "No MQTT client available" });
    }

    if (!mqttClient.connected) {
      console.error("MQTT client is not connected");
      return res.status(503).json({ error: "MQTT client is not connected" });
    }

    // Subscribe to each topic
    for (const { topicFilter, qosLevel } of inputSets) {
      if (!topicFilter) {
        console.warn("Skipping invalid topic filter:", topicFilter);
        continue;
      }

      const qos = parseInt(qosLevel, 10);
      if (![0, 1, 2].includes(qos)) {
        console.warn(`Invalid QoS level ${qosLevel} for topic ${topicFilter}, defaulting to 0`);
      }

      mqttClient.subscribe(topicFilter, { qos: qos || 0 }, (err) => {
        if (err) {
          console.error(`Failed to subscribe to topic ${topicFilter}:`, err.message);
        } else {
          console.log(`Subscribed to topic: ${topicFilter}, QoS: ${qos}`);
        }
      });
    }

    // Store received messages
    mqttClient.on("message", (topic, payload, packet) => {
      const message = {
        topic,
        payload: payload.toString(),
        qos: packet.qos,
      };
      console.log("Received MQTT message:", message);
      messages.push(message);
      // Limit to 100 messages to prevent memory issues
      if (messages.length > 100) {
        messages.shift();
      }
    });

    res.status(200).json({ message: "Subscribed successfully" });
  } catch (error) {
    console.error("Error in subscribe route:", error.message);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

// GET endpoint to fetch stored messages
router.get("/messages", (req, res) => {
//   console.log("Received request at /api/messages");
  res.status(200).json({ messages });
});

module.exports = router;