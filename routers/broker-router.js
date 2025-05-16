const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Broker = require("../models/broker-model");
const MqttHandler = require("../middlewares/mqtt-handler");

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    console.error(`[User: Unknown] Unauthorized: No token provided`);
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  try {
    const decoded = jwt.verify(token, "x-auth-token");
    req.userId = decoded._id;
    console.log(`[User: ${req.userId}] Authentication successful`);
    next();
  } catch (error) {
    console.error(`[User: Unknown] Unauthorized: Invalid token`);
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};

const isValidIPv4 = (ip) => {
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
};

router.post("/test-broker", auth, async (req, res) => {
  try {
    const { brokerIp, portNumber = 1883, username, password } = req.body;
    console.log(`[User: ${req.userId}] Testing broker availability for IP ${brokerIp}:${portNumber}`);
    if (!brokerIp) {
      console.error(`[User: ${req.userId}] Broker IP missing`);
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!isValidIPv4(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid IP address ${brokerIp}`);
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
      console.error(`[User: ${req.userId}] Broker ${brokerIp}:${portNumber} is not available`);
      return res.status(400).json({ message: "Broker is not available" });
    }

    console.log(`[User: ${req.userId}] Broker ${brokerIp}:${portNumber} is available`);
    res.status(200).json({ message: "Broker is available" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error testing broker: ${error.message}`);
    res.status(400).json({
      message: "Failed to test broker",
      error: error.message,
    });
  }
});

router.post("/brokers", auth, async (req, res) => {
  try {
    const { brokerIp, username, password, label, portNumber = 1883 } = req.body;
    console.log(`[User: ${req.userId}] Creating broker with IP ${brokerIp}:${portNumber}, label: ${label}`);
    if (!brokerIp) {
      console.error(`[User: ${req.userId}] Broker IP missing`);
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!isValidIPv4(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid IP address ${brokerIp}`);
      return res.status(400).json({ message: "Invalid IP address format" });
    }
    if (!label) {
      console.error(`[User: ${req.userId}] Label missing`);
      return res.status(400).json({ message: "Label is required" });
    }
    const existingBroker = await Broker.findOne({
      brokerIp,
      userId: req.userId,
    });
    if (existingBroker) {
      console.error(`[User: ${req.userId}] Broker with IP ${brokerIp} already exists`);
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
    console.log(`[User: ${req.userId}] Broker ${broker._id} created with IP ${brokerIp}:${portNumber}`);

    const key = `${req.userId}_${broker._id}`;
    console.log(`[User: ${req.userId}] Initializing MQTT handler for broker ${broker._id} (IP: ${broker.brokerIp})`);
    const mqttHandler = new MqttHandler(null, req.userId, broker);
    req.mqttHandlers.set(key, mqttHandler);
    mqttHandler.connect();

    res.status(201).json(broker);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error creating broker: ${error.message}`);
    res.status(400).json({
      message: "Failed to create broker",
      error: error.message,
    });
  }
});

router.get("/brokers", auth, async (req, res) => {
  try {
    console.log(`[User: ${req.userId}] Fetching brokers`);
    const brokers = await Broker.find({ userId: req.userId });
    console.log(`[User: ${req.userId}] Found ${brokers.length} brokers`);
    res.status(200).json(brokers);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error fetching brokers: ${error.message}`);
    res.status(500).json({
      message: "Failed to fetch brokers",
      error: error.message,
    });
  }
});

router.put("/brokers/:brokerId", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { brokerIp, portNumber = 1883, username, password, label } = req.body;
    console.log(`[ unsalted: ${req.userId}] Updating broker ${brokerId} with IP ${brokerIp}:${portNumber}, label: ${label}`);

    if (!brokerIp) {
      console.error(`[User: ${req.userId}] Broker IP missing`);
      return res.status(400).json({ message: "Broker IP is required" });
    }
    if (!isValidIPv4(brokerIp)) {
      console.error(`[User: ${req.userId}] Invalid IP address ${brokerIp}`);
      return res.status(400).json({ message: "Invalid IP address format" });
    }
    if (!label) {
      console.error(`[User: ${req.userId}] Label missing`);
      return res.status(400).json({ message: "Label is required" });
    }

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const existingBroker = await Broker.findOne({
      brokerIp,
      userId: req.userId,
      _id: { $ne: brokerId },
    });
    if (existingBroker) {
      console.error(`[User: ${req.userId}] Broker with IP ${brokerIp} already exists`);
      return res.status(400).json({ message: "Broker with this IP already exists" });
    }

    broker.brokerIp = brokerIp;
    broker.portNumber = portNumber;
    broker.username = username || "";
    broker.password = password || "";
    broker.label = label;
    await broker.save();
    console.log(`[User: ${req.userId}] Broker ${brokerId} updated successfully`);

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (mqttHandler) {
      console.log(`[User: ${req.userId}] Updating MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp})`);
      mqttHandler.disconnect();
      req.mqttHandlers.delete(key);
      const newMqttHandler = new MqttHandler(null, req.userId, broker);
      req.mqttHandlers.set(key, newMqttHandler);
      newMqttHandler.connect();
    }

    res.status(200).json(broker);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error updating broker ${req.params.brokerId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to update broker",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/subscribe", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { topic } = req.body;
    console.log(`[User: ${req.userId}] Processing subscription for topic ${topic} on broker ${brokerId}`);
    if (!topic) {
      console.error(`[User: ${req.userId}] Topic missing for subscription on broker ${brokerId}`);
      return res.status(400).json({ message: "Topic is required" });
    }
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (!mqttHandler || !mqttHandler.isConnected()) {
      console.error(`[User: ${req.userId}] MQTT handler not found or not connected for broker ${brokerId}`);
      return res.status(400).json({ message: "MQTT client not connected" });
    }

    mqttHandler.subscribe(topic);
    res.status(200).json({ message: `Subscribed to topic ${topic}`, brokerId });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error processing subscription: ${error.message}`);
    res.status(400).json({
      message: "Failed to process subscription",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/connect", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Processing connection request for broker ${brokerId}`);
    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    let mqttHandler = req.mqttHandlers.get(key);
    if (!mqttHandler) {
      console.log(`[User: ${req.userId}] Creating new MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp})`);
      mqttHandler = new MqttHandler(null, req.userId, broker);
      req.mqttHandlers.set(key, mqttHandler);
    }

    mqttHandler.connect();

    let attempts = 0;
    const maxAttempts = 10;
    const checkConnection = async () => {
      if (mqttHandler.isConnected()) {
        await Broker.updateOne(
          { _id: brokerId, userId: req.userId },
          { connectionStatus: "connected" }
        );
        console.log(`[User: ${req.userId}] Broker ${brokerId} connected successfully`);
        return { status: "connected" };
      }
      if (attempts >= maxAttempts) {
        await Broker.updateOne(
          { _id: brokerId, userId: req.userId },
          { connectionStatus: "disconnected" }
        );
        console.error(`[User: ${req.userId}] Broker ${brokerId} failed to connect after 5 seconds`);
        return { status: "disconnected", error: "Connection timed out after 5 seconds" };
      }
      attempts++;
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(await checkConnection());
        }, 500);
      });
    };

    const result = await checkConnection();
    if (result.status === "connected") {
      res.status(200).json({ message: "Broker connected successfully", brokerId });
    } else {
      res.status(400).json({ message: result.error || "Failed to connect to broker", brokerId });
    }
  } catch (error) {
    console.error(`[User: ${req.userId}] Error processing connection request: ${error.message}`);
    res.status(400).json({
      message: "Failed to process connection request",
      error: error.message,
    });
  }
});

router.delete("/brokers/:brokerId", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Processing delete request for broker ${brokerId}`);

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    await Broker.deleteOne({ _id: brokerId, userId: req.userId });
    console.log(`[User: ${req.userId}] Broker ${brokerId} deleted from database`);

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (mqttHandler) {
      console.log(`[User: ${req.userId}] Disconnecting MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp})`);
      mqttHandler.disconnect();
      req.mqttHandlers.delete(key);
      console.log(`[User: ${req.userId}] MQTT handler for broker ${brokerId} removed`);
    }

    res.status(200).json({ message: "Broker deleted successfully" });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error deleting broker ${req.params.brokerId}: ${error.message}`);
    res.status(500).json({
      message: "Failed to delete broker",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/publish", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    const { topic, message } = req.body;
    console.log(`[User: ${req.userId}] Processing publish request for topic ${topic} on broker ${brokerId}`);
    if (!topic || !message) {
      console.error(`[User: ${req.userId}] Topic or message missing for publish on broker ${brokerId}`);
      return res.status(400).json({ message: "Topic and message are required" });
    }

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (!mqttHandler || !mqttHandler.isConnected()) {
      console.error(`[User: ${req.userId}] MQTT handler not found or not connected for broker ${brokerId}`);
      return res.status(400).json({ message: "MQTT client not connected" });
    }

    mqttHandler.publish(topic, message);
    res.status(200).json({ message: `Published to topic ${topic}`, brokerId });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error processing publish: ${error.message}`);
    res.status(400).json({
      message: "Failed to publish message",
      error: error.message,
    });
  }
});

router.post("/brokers/:brokerId/disconnect", auth, async (req, res) => {
  try {
    const { brokerId } = req.params;
    console.log(`[User: ${req.userId}] Processing disconnect request for broker ${brokerId}`);

    const broker = await Broker.findOne({ _id: brokerId, userId: req.userId });
    if (!broker) {
      console.error(`[User: ${req.userId}] Broker ${brokerId} not found`);
      return res.status(404).json({ message: "Broker not found" });
    }

    const key = `${req.userId}_${brokerId}`;
    const mqttHandler = req.mqttHandlers.get(key);
    if (mqttHandler) {
      console.log(`[User: ${req.userId}] Disconnecting MQTT handler for broker ${brokerId} (IP: ${broker.brokerIp})`);
      mqttHandler.disconnect();
      req.mqttHandlers.delete(key);
      console.log(`[User: ${req.userId}] MQTT handler for broker ${brokerId} removed`);
    }

    await Broker.updateOne(
      { _id: brokerId, userId: req.userId },
      { connectionStatus: "disconnected" }
    );

    res.status(200).json({ message: "Broker disconnected successfully", brokerId });
  } catch (error) {
    console.error(`[User: ${req.userId}] Error disconnecting broker ${brokerId}: ${error.message}`);
    res.status(400).json({
      message: "Failed to disconnect broker",
      error: error.message,
    });
  }
});

module.exports = router;
