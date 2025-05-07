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
    this.retryDelay = 5000; // 5 seconds between retries
  }

  // Validate IPv4 address
  isValidIPv4(ip) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
  }

  async testConnection(port) {
    return new Promise((resolve) => {
      if (!this.isValidIPv4(this.broker.brokerIp)) {
        console.error(`Invalid IP address: ${this.broker.brokerIp} for client ${this.clientId}`);
        resolve(false);
        return;
      }

      const clientId = `test_${this.userId}_${Date.now()}`;
      const brokerUrl = `mqtt://${this.broker.brokerIp}:${port}`;
      const options = {
        clientId,
        username: this.broker.username || "",
        password: this.broker.password || "",
        connectTimeout: 5 * 1000, // 5 seconds timeout
      };

      console.log(`Testing connection to ${brokerUrl} for client ${clientId}`);
      const client = mqtt.connect(brokerUrl, options);

      client.on("connect", () => {
        console.log(`Test connection successful to ${brokerUrl} for client ${clientId}`);
        client.end(true);
        resolve(true);
      });

      client.on("error", (err) => {
        console.error(`Test connection failed to ${brokerUrl} for client ${clientId}: ${err.message}`);
        client.end(true);
        resolve(false);
      });

      client.on("close", () => {
        if (this.connectionStatus !== "connected") {
          console.log(`Test connection closed for ${brokerUrl} for client ${clientId}`);
          resolve(false);
        }
      });
    });
  }

  connect() {
    this.connectionStatus = "disconnected";
    this.retryAttempts = 0;
    console.log(`Initiating MQTT connection for ${this.clientId} to ${this.brokerUrl}`);
    this.attemptConnection();
  }

  attemptConnection() {
    if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
      console.log(`MQTT client ${this.clientId} already ${this.connectionStatus} for ${this.brokerUrl}`);
      return;
    }

    if (!this.isValidIPv4(this.broker.brokerIp)) {
      console.error(`Invalid IP address: ${this.broker.brokerIp} for client ${this.clientId}`);
      if (this.socket) {
        this.socket.emit("error", {
          message: `Invalid IP address: ${this.broker.brokerIp}`,
          brokerId: this.broker._id,
        });
      }
      this.connectionStatus = "disconnected";
      return;
    }

    if (this.retryAttempts >= this.maxRetries) {
      console.error(`MQTT client ${this.clientId} reached max retry attempts (${this.maxRetries}) for ${this.brokerUrl}`);
      if (this.socket) {
        this.socket.emit("error", {
          message: `Failed to connect to broker after ${this.maxRetries} attempts`,
          brokerId: this.broker._id,
        });
      }
      this.disconnect();
      return;
    }

    this.connectionStatus = "connecting";
    this.retryAttempts++;
    console.log(`MQTT client ${this.clientId} transitioning to ${this.connectionStatus} for ${this.brokerUrl} (attempt ${this.retryAttempts}/${this.maxRetries})`);
    if (this.socket) {
      this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
    }

    const options = {
      clientId: this.clientId,
      username: this.broker.username || "",
      password: this.broker.password || "",
      reconnectPeriod: 0, // Disable auto-reconnect to manage retries manually
      connectTimeout: 30 * 1000, // 30 seconds timeout
      keepalive: 60, // Keep-alive ping every 60 seconds
    };

    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on("connect", () => {
      this.connectionStatus = "connected";
      this.retryAttempts = 0;
      console.log(`MQTT client ${this.clientId} connected to ${this.broker.brokerIp}:${this.broker.portNumber || 1883} for user ${this.userId}`);
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
      }
    });

    this.client.on("message", (topic, message) => {
      const messageStr = message.toString();
      console.log(`MQTT client ${this.clientId} received message on topic ${topic} from ${this.brokerUrl}:`);
      console.log(`Message Content: ${messageStr}`);
      console.log(`Broker ID: ${this.broker._id}, User ID: ${this.userId}`);
      try {
        const parsedMessage = JSON.parse(messageStr);
        console.log('Parsed Message:', JSON.stringify(parsedMessage, null, 2));
      } catch (e) {
        console.log('Message is not JSON, treating as plain text');
      }
      if (this.socket) {
        this.socket.emit("mqtt_message", {
          topic,
          message: messageStr,
          brokerId: this.broker._id,
        });
      }
    });

    this.client.on("error", (err) => {
      console.error(`MQTT client ${this.clientId} error (status: ${this.connectionStatus}) for ${this.brokerUrl}: ${err.message}`);
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
        console.log(`MQTT client ${this.clientId} disconnected from ${this.broker.brokerIp}:${this.broker.portNumber || 1883}`);
        if (this.socket) {
          this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
        }
        this.handleReconnect();
      }
    });

    this.client.on("offline", () => {
      console.log(`MQTT client ${this.clientId} is offline for ${this.brokerUrl}`);
    });
  }

  handleReconnect() {
    if (this.connectionStatus === "disconnected" && this.retryAttempts < this.maxRetries) {
      console.log(`MQTT client ${this.clientId} scheduling reconnect for ${this.brokerUrl} in ${this.retryDelay}ms (attempt ${this.retryAttempts + 1}/${this.maxRetries})`);
      setTimeout(() => {
        this.attemptConnection();
      }, this.retryDelay);
    } else if (this.retryAttempts >= this.maxRetries) {
      console.error(`MQTT client ${this.clientId} reached max retry attempts (${this.maxRetries}) for ${this.brokerUrl}`);
      this.disconnect();
    }
  }

  subscribe(topic) {
    if (this.client && this.client.connected) {
      console.log(`MQTT client ${this.clientId} subscribing to topic ${topic} for ${this.brokerUrl}`);
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`MQTT client ${this.clientId} subscription error for topic ${topic} on ${this.brokerUrl}: ${err.message}`);
          if (this.socket) {
            this.socket.emit("error", {
              message: `Subscription error: ${err.message}`,
              brokerId: this.broker._id,
            });
          }
        } else {
          console.log(`MQTT client ${this.clientId} subscribed to ${topic} for user ${this.userId} on ${this.brokerUrl}`);
          if (this.socket) {
            this.socket.emit("subscribed", { topic, brokerId: this.broker._id });
          }
        }
      });
    } else {
      console.error(`MQTT client ${this.clientId} cannot subscribe to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl}`);
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
      console.log(`MQTT client ${this.clientId} publishing to topic ${topic} on ${this.brokerUrl}: ${message}`);
      this.client.publish(topic, message, { qos: 0 }, (err) => {
        if (err) {
          console.error(`MQTT client ${this.clientId} publish error for topic ${topic} on ${this.brokerUrl}: ${err.message}`);
          if (this.socket) {
            this.socket.emit("error", {
              message: `Publish error: ${err.message}`,
              brokerId: this.broker._id,
            });
          }
        } else {
          console.log(`MQTT client ${this.clientId} successfully published to ${topic} for user ${this.userId} on ${this.brokerUrl}`);
          if (this.socket) {
            this.socket.emit("published", { topic, brokerId: this.broker._id });
          }
        }
      });
    } else {
      console.error(`MQTT client ${this.clientId} cannot publish to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl}`);
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
      this.retryAttempts = 0;
      console.log(`MQTT client ${this.clientId} disconnecting (status: ${this.connectionStatus}) from ${this.brokerUrl}`);
      this.client.end(true); // Force close
      this.client = null;
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
      }
    }
  }

  updateSocket(newSocket) {
    this.socket = newSocket;
  }

  isConnected() {
    return this.client && this.client.connected && this.connectionStatus === "connected";
  }
}

module.exports = MqttHandler;