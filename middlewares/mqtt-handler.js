const mqtt = require("mqtt");

class MqttHandler {
  constructor(socket, userId, broker) {
    this.socket = socket;
    this.userId = userId;
    this.broker = broker;
    this.client = null;
    this.clientId = `server_${userId}_${broker._id}`;
    this.brokerUrl = `mqtt://${broker.brokerIp}:1883`;
    this.connectionStatus = "disconnected";
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000; // Initial delay in ms
  }

  connect() {
    if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
      console.log(`MQTT client ${this.clientId} already ${this.connectionStatus}`);
      return;
    }

    this.connectionStatus = "connecting";
    this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
    console.log(`Attempting to connect to MQTT broker at ${this.brokerUrl}`);

    const options = {
      clientId: this.clientId,
      username: this.broker.username || "",
      password: this.broker.password || "",
      reconnectPeriod: 0, // Disable auto-reconnect to manage retries manually
      connectTimeout: 30 * 1000, // 30 seconds timeout
    };

    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on("connect", () => {
      this.connectionStatus = "connected";
      this.retryAttempts = 0;
      console.log(`MQTT connected to ${this.broker.brokerIp}:1883 for user ${this.userId}`);
      this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
    });

    this.client.on("message", (topic, message) => {
      console.log(`Received MQTT message on topic ${topic}: ${message.toString()}`);
      this.socket.emit("mqtt_message", {
        topic,
        message: message.toString(),
        brokerId: this.broker._id,
      });
    });

    this.client.on("error", (err) => {
      console.error(`MQTT error for ${this.broker.brokerIp}:1883:`, err.message);
      this.socket.emit("error", {
        message: `MQTT error: ${err.message}`,
        brokerId: this.broker._id,
      });
      this.handleReconnect();
    });

    this.client.on("close", () => {
      if (this.connectionStatus !== "disconnected") {
        this.connectionStatus = "disconnected";
        console.log(`MQTT disconnected from ${this.broker.brokerIp}:1883`);
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
        this.handleReconnect();
      }
    });
  }

  handleReconnect() {
    if (this.retryAttempts >= this.maxRetries) {
      console.error(`Max retry attempts reached for ${this.brokerUrl}`);
      this.disconnect();
      return;
    }

    this.retryAttempts++;
    const delay = this.retryDelay * Math.pow(2, this.retryAttempts); // Exponential backoff
    console.log(`Retrying connection to ${this.brokerUrl} in ${delay}ms (attempt ${this.retryAttempts})`);

    setTimeout(() => {
      if (this.connectionStatus === "disconnected") {
        this.connect();
      }
    }, delay);
  }

  subscribe(topic) {
    if (this.client && this.client.connected) {
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`Subscription error for topic ${topic}:`, err.message);
          this.socket.emit("error", {
            message: `Subscription error: ${err.message}`,
            brokerId: this.broker._id,
          });
        } else {
          console.log(`Subscribed to ${topic} for user ${this.userId}`);
          this.socket.emit("subscribed", { topic, brokerId: this.broker._id });
        }
      });
    } else {
      this.socket.emit("error", {
        message: "MQTT client not connected",
        brokerId: this.broker._id,
      });
    }
  }

  disconnect() {
    if (this.client) {
      this.connectionStatus = "disconnected";
      this.client.end(true); // Force close
      this.client = null;
      console.log(`MQTT client ${this.clientId} disconnected`);
      this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
    }
  }
}

module.exports = MqttHandler;