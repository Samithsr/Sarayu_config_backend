// publish-router.js
const express = require("express");
const mqtt = require("mqtt");
const router = express.Router();

// POST route to handle publishing MQTT messages
router.post("/publish", async (req, res) => {
  try {
    const { inputSets } = req.body;
    const { mqttHandlers, connectedBrokers } = req;

    // Validate inputSets
    if (!Array.isArray(inputSets) || inputSets.length === 0) {
      console.error("Invalid or empty inputSets:", inputSets);
      return res.status(400).json({ error: "Invalid or empty inputSets" });
    }

    // Get the first available MQTT client
    const mqttClient = Array.from(mqttHandlers.values())[0] || Array.from(connectedBrokers.values())[0]?.client;

    if (!mqttClient || !mqttClient.connected) {
      console.error("No connected MQTT broker available. mqttHandlers:", mqttHandlers, "connectedBrokers:", connectedBrokers);
      return res.status(503).json({ error: "No connected MQTT broker available" });
    }

    // Publish each input set
    for (const { topic, qosLevel, payload } of inputSets) {
      if (!topic || !payload) {
        console.warn(`Skipping invalid input set: topic=${topic}, payload=${payload}`);
        continue;
      }

      const qos = parseInt(qosLevel, 10);
      if (![0, 1, 2].includes(qos)) {
        console.warn(`Invalid QoS level ${qosLevel} for topic ${topic}, defaulting to 0`);
      }

      // Publish the message
      mqttClient.publish(topic, payload, { qos: qos || 0 }, (err) => {
        if (err) {
          console.error(`Failed to publish to topic ${topic}:`, err.message);
        } else {
          console.log(`Published to topic: ${topic}, QoS: ${qos}, Payload: ${payload}`);
        }
      });
    }

    res.status(200).json({ message: "Publish request processed successfully" });
  } catch (error) {
    console.error("Error in publish route:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;