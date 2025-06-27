const express = require("express");
const mqtt = require("mqtt");
const router = express.Router();
const Broker = require("../models/broker-model");

// Store MQTT clients to reuse connections
const mqttClients = new Map();

function getMqttClient(brokerIp, options) {
  if (!mqttClients.has(brokerIp)) {
    const client = mqtt.connect(`mqtt://${brokerIp}`, {
      ...options,
      connectTimeout: 5000, // 5-second timeout
    });
    mqttClients.set(brokerIp, client);
    client.on("error", (err) => {
      console.error(`MQTT error for broker ${brokerIp}:`, err.message);
      mqttClients.delete(brokerIp);
    });
    client.on("close", () => {
      console.log(`MQTT connection closed for broker ${brokerIp}`);
      mqttClients.delete(brokerIp);
    });
  }
  return mqttClients.get(brokerIp);
}

router.post("/publish", async (req, res) => {
  try {
    console.log("REquest : ",req)
    console.log("Request body : ",req.body)
    const { brokerIp, topic, qosLevel, payload, mqttUsername, mqttPassword } = req.body;

    // Log incoming request
    console.log("Received publish request:", {
      brokerIp,
      topic,
      qosLevel,
      payload,
      mqttUsername: mqttUsername || "none",
      mqttPassword: mqttPassword ? "****" : "none",
    });

    // Detailed input validation
    if (!brokerIp || typeof brokerIp !== "string" || brokerIp.trim() === "") {
      console.error("Invalid brokerIp:", brokerIp);
      return res.status(400).json({ success: false, message: "Valid Broker IP is required" });
    }
    if (!topic || typeof topic !== "string" || topic.trim() === "") {
      console.error("Invalid topic:", topic);
      return res.status(400).json({ success: false, message: "Valid topic is required" });
    }
    if (!payload || typeof payload !== "string" || payload.trim() === "") {
      console.error("Invalid payload:", payload);
      return res.status(400).json({ success: false, message: "Valid payload is required" });
    }
    const qos = parseInt(qosLevel, 10);
    if (isNaN(qos) || ![0, 1, 2].includes(qos)) {
      console.error(`Invalid QoS level: ${qosLevel}`);
      return res.status(400).json({ success: false, message: `Invalid QoS level: ${qosLevel}. Must be 0, 1, or 2` });
    }

    // Validate brokerIp against Broker collection
    const broker = await Broker.findOne({ brokerIp });
    if (!broker) {
      console.error(`Broker IP ${brokerIp} not found in database`);
      return res.status(400).json({ success: false, message: `Broker IP ${brokerIp} not found in database` });
    }

    // Create MQTT connection options
    const options = {
      username: mqttUsername && mqttUsername.trim() !== "" ? mqttUsername : undefined,
      password: mqttPassword && mqttPassword.trim() !== "" ? mqttPassword : undefined,
      clientId: `publish_${Math.random().toString(16).slice(3)}`,
    };

    console.log(`Attempting to connect to broker ${brokerIp} with options:`, {
      username: options.username || "none",
      clientId: options.clientId,
    });

    // Get or create MQTT client
    const mqttClient = getMqttClient(brokerIp, options);

    // Handle connection
    const connectPromise = new Promise((resolve, reject) => {
      if (mqttClient.connected) {
        resolve();
      } else {
        mqttClient.on("connect", resolve);
        mqttClient.on("error", reject);
      }
    });

    try {
      await connectPromise;
      console.log(`Connected to MQTT broker: ${brokerIp}`);

      // Publish the message
      await new Promise((resolve, reject) => {
        mqttClient.publish(topic, payload, { qos }, (err) => {
          if (err) {
            console.error(`Failed to publish to topic ${topic} on broker ${brokerIp}:`, err.message);
            reject(new Error(`Failed to publish: ${err.message}`));
          } else {
            console.log(
              `Published to topic: ${topic}, QoS: ${qos}, Payload: ${payload}, Broker: ${brokerIp}, Username: ${
                mqttUsername || "none"
              }, Password: ${mqttPassword ? "****" : "none"}`
            );
            resolve();
          }
        });
      });

      res.status(200).json({ success: true, message: "Published successfully" });
    } catch (err) {
      console.error(`MQTT connection or publish error for broker ${brokerIp}:`, err.message);
      mqttClients.delete(brokerIp);
      mqttClient.end();
      return res.status(500).json({ success: false, message: `MQTT error: ${err.message}` });
    }
  } catch (error) {
    console.error("Error in publish route:", error.message);
    res.status(500).json({ success: false, message: `Internal server error: ${error.message}` });
  }
});

// Cleanup on server shutdown
process.on("SIGTERM", () => {
  mqttClients.forEach((client, brokerIp) => {
    console.log(`Closing MQTT client for ${brokerIp}`);
    client.end();
  });
});

module.exports = router;