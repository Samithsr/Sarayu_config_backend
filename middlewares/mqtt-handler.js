const mqtt = require("mqtt");

class MqttHandler {
  constructor(socket, userId, broker) {
    this.socket = socket;
    this.userId = userId;
    this.broker = broker;
    this.client = null;
    this.clientId = `server_${userId}_${broker._id}`;
    this.brokerUrl = `mqtt://${broker.brokerIp}:${broker.portNumber || 1883}`;
    this.connectionStatus = "disconnected";
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 1000; // Initial delay in ms
  }

  async testConnection(port) {
    return new Promise((resolve) => {
      const clientId = `test_${this.userId}_${Date.now()}`;
      const brokerUrl = `mqtt://${this.broker.brokerIp}:${port}`;
      const options = {
        clientId,
        username: this.broker.username || "",
        password: this.broker.password || "",
        connectTimeout: 5 * 1000, // 5 seconds timeout
      };

      const client = mqtt.connect(brokerUrl, options);

      client.on("connect", () => {
        client.end(true);
        resolve(true);
      });

      client.on("error", () => {
        client.end(true);
        resolve(false);
      });

      client.on("close", () => {
        if (this.connectionStatus !== "connected") {
          resolve(false);
        }
      });
    });
  }

  connect() {
    if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
      console.log(`MQTT socket ${this.clientId} already ${this.connectionStatus} for ${this.brokerUrl}`);
      return;
    }

    this.connectionStatus = "connecting";
    console.log(`MQTT socket ${this.clientId} transitioning to ${this.connectionStatus} for ${this.brokerUrl}`);
    if (this.socket) {
      this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
    }
    console.log(`Initiating MQTT socket connection to ${this.brokerUrl}`);

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
      console.log(`MQTT is connected: ${this.clientId} to ${this.broker.brokerIp}:${this.broker.portNumber || 1883} for user ${this.userId}`);
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
      }
    });

    this.client.on("message", (topic, message) => {
      console.log(`MQTT socket ${this.clientId} received message on topic ${topic}: ${message.toString()} from ${this.brokerUrl}`);
      if (this.socket) {
        this.socket.emit("mqtt_message", {
          topic,
          message: message.toString(),
          brokerId: this.broker._id,
        });
      }
    });

    this.client.on("error", (err) => {
      console.error(`MQTT socket ${this.clientId} error (status: ${this.connectionStatus}) for ${this.brokerUrl}: ${err.message}`);
      if (this.socket) {
        this.socket.emit("error", {
          message: `MQTT error: ${err.message}`,
          brokerId: this.broker._id,
        });
      }
      this.handleReconnect();
    });

    this.client.on("close", () => {
      if (this.connectionStatus !== "disconnected") {
        this.connectionStatus = "disconnected";
        console.log(`MQTT socket ${this.clientId} disconnected from ${this.broker.brokerIp}:${this.broker.portNumber || 1883}`);
        if (this.socket) {
          this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
        }
        this.handleReconnect();
      }
    });
  }

  handleReconnect() {
    if (this.retryAttempts >= this.maxRetries) {
      console.error(`MQTT socket ${this.clientId} reached max retry attempts for ${this.brokerUrl} (status: ${this.connectionStatus})`);
      this.disconnect();
      return;
    }

    this.retryAttempts++;
    const delay = this.retryDelay * Math.pow(2, this.retryAttempts); // Exponential backoff
    console.log(`MQTT socket ${this.clientId} retrying connection to ${this.brokerUrl} in ${delay}ms (attempt ${this.retryAttempts}, status: ${this.connectionStatus})`);

    setTimeout(() => {
      if (this.connectionStatus === "disconnected") {
        this.connect();
      }
    }, delay);
  }

  subscribe(topic) {
    if (this.client && this.client.connected) {
      console.log(`MQTT socket ${this.clientId} subscribing to topic ${topic} for ${this.brokerUrl}`);
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`MQTT socket ${this.clientId} subscription error for topic ${topic} on ${this.brokerUrl}: ${err.message}`);
          if (this.socket) {
            this.socket.emit("error", {
              message: `Subscription error: ${err.message}`,
              brokerId: this.broker._id,
            });
          }
        } else {
          console.log(`MQTT socket ${this.clientId} subscribed to ${topic} for user ${this.userId} on ${this.brokerUrl}`);
          if (this.socket) {
            this.socket.emit("subscribed", { topic, brokerId: this.broker._id });
          }
        }
      });
    } else {
      console.error(`MQTT socket ${this.clientId} cannot subscribe to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl}`);
      if (this.socket) {
        this.socket.emit("error", {
          message: "MQTT client not connected",
          brokerId: this.broker._id,
        });
      }
    }
  }

  publish(topic, message) {
    if (this.client && this.client.connected) {
      console.log(`MQTT socket ${this.clientId} publishing to topic ${topic} on ${this.brokerUrl}: ${message}`);

      this.client.publish(topic, message, { qos: 0 }, (err) => {
        if (err) {
          console.error(`MQTT socket ${this.clientId} publish error for topic ${topic} on ${this.brokerUrl}: ${err.message}`);
          if (this.socket) {
            this.socket.emit("error", {
              message: `Publish error: ${err.message}`,
              brokerId: this.broker._id,
            });
          }
        } else {
          console.log(`MQTT socket ${this.clientId} successfully published to ${topic} for user ${this.userId} on ${this.brokerUrl}`);
          if (this.socket) {
            this.socket.emit("published", { topic, brokerId: this.broker._id });
          }
        }
      });
    } else {
      console.error(`MQTT socket ${this.clientId} cannot publish to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl}`);
      if (this.socket) {
        this.socket.emit("error", {
          message: "MQTT client not connected",
          brokerId: this.broker._id,
        });
      }
    }
  }

  disconnect() {
    if (this.client) {
      this.connectionStatus = "disconnected";
      console.log(`MQTT socket ${this.clientId} disconnecting (status: ${this.connectionStatus}) from ${this.brokerUrl}`);
      this.client.end(true); // Force close
      this.client = null;
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
      }
    }
  }
}

module.exports = MqttHandler;