const express = require("express");
const mqtt = require("mqtt");
const router = express.Router();

// POST route to handle WiFi and Location configuration publishing
router.post("/wifi/user/pub/publish", async (req, res) => {
  console.log("Received request at /api/wifi/user/pub/publish:", req.body); // Log incoming request

  try {
    const { topic, payload, qosLevel } = req.body;
    const { mqttHandlers, connectedBrokers } = req;

    // Validate input
    if (!topic || !payload) {
      console.error("Invalid input: topic or payload missing", { topic, payload });
      return res.status(400).json({ error: "Topic and payload are required" });
    }

    // Log available MQTT clients
    console.log("Available mqttHandlers:", Array.from(mqttHandlers.keys()));
    console.log("Available connectedBrokers:", Array.from(connectedBrokers.keys()));

    // Get the first available MQTT client
    const mqttClient = Array.from(mqttHandlers.values())[0] || Array.from(connectedBrokers.values())[0]?.client;

    if (!mqttClient) {
      console.error("No MQTT client available");
      return res.status(503).json({ error: "No MQTT client available" });
    }

    if (!mqttClient.connected) {
      console.error("MQTT client is not connected");
      return res.status(503).json({ error: "MQTT client is not connected" });
    }

    const qos = parseInt(qosLevel, 10);
    if (![0, 1, 2].includes(qos)) {
      console.warn(`Invalid QoS level ${qosLevel} for topic ${topic}, defaulting to 0`);
    }

    // Publish the message
    mqttClient.publish(topic, payload, { qos: qos || 0 }, (err) => {
      if (err) {
        console.error(`Failed to publish to topic ${topic}:`, err.message);
        return res.status(500).json({ error: `Failed to publish: ${err.message}` });
      }
      console.log(`Published to topic: ${topic}, QoS: ${qos || 0}, Payload: ${payload}`);
      res.status(200).json({ message: "Configuration published successfully" });
    });
  } catch (error) {
    console.error("Error in publish route:", error.message);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

module.exports = router;