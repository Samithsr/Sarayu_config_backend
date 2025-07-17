const express = require("express");
const mqtt = require("mqtt");
const router = express.Router();

// In-memory message store (use MongoDB for production)
let messages = [];

router.post("/subscribe", async (req, res) => {
  console.log("Received request at /api/subscribe:", req.body);

  try {
    const { inputSets } = req.body;

    if (!Array.isArray(inputSets) || inputSets.length === 0) {
      console.error("Invalid or empty inputSets:", inputSets);
      return res.status(400).json({ error: "Invalid or empty inputSets" });
    }

    const { brokerIp, mqttUsername, mqttPassword } = inputSets[0];
    if (!brokerIp) {
      console.error("No brokerIp provided in inputSets");
      return res.status(400).json({ error: "Broker IP is required" });
    }

    const options = {
      username: mqttUsername || undefined,
      password: mqttPassword || undefined,
      clientId: `subscribe_${Math.random().toString(16).slice(3)}`,
    };

    const mqttClient = mqtt.connect(`mqtt://${brokerIp}`, options);

    mqttClient.on("connect", () => {
      console.log(`Connected to MQTT broker: ${brokerIp}`);

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
            console.log(`Subscribed to topic: ${topicFilter}, QoS: ${qos}, Broker: ${brokerIp}`);
          }
        });
      }

      res.status(200).json({ message: "Subscribed successfully" });
    });

    mqttClient.on("message", (topic, payload, packet) => {
      const message = {
        topic,
        payload: payload.toString(),
        qos: packet.qos,
      };
      console.log("Received MQTT message:", message);
      messages.push(message);
      if (messages.length > 100) {
        messages.shift();
      }
      
      // Broadcast to Socket.IO clients
      req.io.emit("mqtt_message", message);
    });

    mqttClient.on("error", (err) => {
      console.error(`MQTT connection error for broker ${brokerIp}:`, err.message);
      mqttClient.end();
      res.status(500).json({ error: `MQTT connection error: ${err.message}` });
    });

  } catch (error) {
    console.error("Error in subscribe route:", error.message);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

router.get("/messages", (req, res) => {
  res.status(200).json({ messages });
});

module.exports = router;