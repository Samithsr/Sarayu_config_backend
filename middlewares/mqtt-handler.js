const mqtt = require("mqtt");

class MqttHandler {
  constructor(socket, userId, broker) {
    this.socket = socket;
    this.userId = userId;
    this.broker = broker;
    this.client = null;
    this.clientId = `server_${userId}_${broker._id}_${Date.now()}`;
    this.brokerUrl = `mqtt://${broker.brokerIp}:${broker.portNumber || 1883}`;
    this.connectionStatus = "disconnected";
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
    console.log(`[User: ${this.userId}] MQTT handler initialized for ${this.clientId} (Broker ID: ${broker._id}, IP: ${broker.brokerIp}, Port: ${broker.portNumber || 1883})`);
  }

  isValidIPv4(ip) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
  }

  async testConnection(port) {
    return new Promise((resolve) => {
      if (!this.isValidIPv4(this.broker.brokerIp)) {
        console.error(`[User: ${this.userId}] Invalid IP address: ${this.broker.brokerIp} for client ${this.clientId}`);
        resolve(false);
        return;
      }

      const clientId = `test_${this.userId}_${Date.now()}`;
      const brokerUrl = `mqtt://${this.broker.brokerIp}:${port}`;
      const options = {
        clientId,
        username: this.broker.username || "",
        password: this.broker.password || "",
        connectTimeout: 5 * 1000,
      };

      console.log(`[User: ${this.userId}] Testing connection to ${brokerUrl} for client ${clientId}`);
      const client = mqtt.connect(brokerUrl, options);

      client.on("connect", () => {
        console.log(`[User: ${this.userId}] Test connection successful to ${brokerUrl} for client ${clientId}`);
        client.end(true);
        resolve(true);
      });

      client.on("error", (err) => {
        console.error(`[User: ${this.userId}] Test connection failed to ${brokerUrl} for client ${clientId}: ${err.message}`);
        client.end(true);
        resolve(false);
      });

      client.on("close", () => {
        if (this.connectionStatus !== "connected") {
          console.log(`[User: ${this.userId}] Test connection closed for ${brokerUrl} for client ${clientId}`);
          resolve(false);
        }
      });
    });
  }

  connect() {
    this.connectionStatus = "disconnected";
    this.retryAttempts = 0;
    console.log(`[User: ${this.userId}] Initiating MQTT connection for ${this.clientId} to ${this.brokerUrl} (Broker ID: ${this.broker._id}, IP: ${this.broker.brokerIp})`);
    this.attemptConnection();
  }

  attemptConnection() {
    if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} already ${this.connectionStatus} for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      return;
    }

    if (!this.isValidIPv4(this.broker.brokerIp)) {
      console.error(`[User: ${this.userId}] Invalid IP address: ${this.broker.brokerIp} for client ${this.clientId} (Broker ID: ${this.broker._id})`);
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
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} reached max retry attempts (${this.maxRetries}) for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
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
    console.log(`[User: ${this.userId}] MQTT client ${this.clientId} transitioning to ${this.connectionStatus} for ${this.brokerUrl} (attempt ${this.retryAttempts}/${this.maxRetries}, Broker ID: ${this.broker._id})`);
    if (this.socket) {
      this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
      console.log(`[User: ${this.userId}] Emitted mqtt_status for broker ${this.broker._id}: ${this.connectionStatus} to socket ${this.socket.id}`);
    }

    const options = {
      clientId: this.clientId,
      username: this.broker.username || "",
      password: this.broker.password || "",
      reconnectPeriod: 0,
      connectTimeout: 30 * 1000,
      keepalive: 60,
    };

    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on("connect", () => {
      this.connectionStatus = "connected";
      this.retryAttempts = 0;
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} connected to ${this.broker.brokerIp}:${this.broker.portNumber || 1883} (Broker ID: ${this.broker._id})`);
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
        console.log(`[User: ${this.userId}] Emitted mqtt_status for broker ${this.broker._id}: ${this.connectionStatus} to socket ${this.socket.id}`);
      }
    });

    this.client.on("message", (topic, message) => {
      const messageStr = message.toString();
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} received message on topic ${topic} from ${this.brokerUrl} (Broker ID: ${this.broker._id}):`);
      console.log(`[User: ${this.userId}] Message Content: ${messageStr}`);
      try {
        const parsedMessage = JSON.parse(messageStr);
        console.log(`[User: ${this.userId}] Parsed Message:`, JSON.stringify(parsedMessage, null, 2));
      } catch (e) {
        console.log(`[User: ${this.userId}] Message is not JSON, treating as plain text`);
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
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} error (status: ${this.connectionStatus}) for ${this.brokerUrl} (Broker ID: ${this.broker._id}): ${err.message}`);
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
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} disconnected from ${this.broker.brokerIp}:${this.broker.portNumber || 1883} (Broker ID: ${this.broker._id})`);
        if (this.socket) {
          this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
          console.log(`[User: ${this.userId}] Emitted mqtt_status for broker ${this.broker._id}: ${this.connectionStatus} to socket ${this.socket.id}`);
        }
        this.handleReconnect();
      }
    });

    this.client.on("offline", () => {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} is offline for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
    });
  }

  handleReconnect() {
    if (this.connectionStatus === "disconnected" && this.retryAttempts < this.maxRetries) {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} scheduling reconnect for ${this.brokerUrl} in ${this.retryDelay}ms (attempt ${this.retryAttempts + 1}/${this.maxRetries}, Broker ID: ${this.broker._id})`);
      setTimeout(() => {
        this.attemptConnection();
      }, this.retryDelay);
    } else if (this.retryAttempts >= this.maxRetries) {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} reached max retry attempts (${this.maxRetries}) for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      this.disconnect();
      if (this.socket) {
        this.socket.emit("error", {
          message: `Failed to reconnect to broker after ${this.maxRetries} attempts`,
          brokerId: this.broker._id,
        });
      }
    }
  }

  subscribe(topic) {
    if (this.client && this.client.connected) {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} subscribing to topic ${topic} for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`[User: ${this.userId}] MQTT client ${this.clientId} subscription error for topic ${topic} on ${this.brokerUrl} (Broker ID: ${this.broker._id}): ${err.message}`);
          if (this.socket) {
            this.socket.emit("error", {
              message: `Subscription error: ${err.message}`,
              brokerId: this.broker._id,
            });
          }
        } else {
          console.log(`[User: ${this.userId}] MQTT client ${this.clientId} subscribed to ${topic} on ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
          if (this.socket) {
            this.socket.emit("subscribed", { topic, brokerId: this.broker._id });
          }
        }
      });
    } else {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} cannot subscribe to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      if (this.socket) {
        this.socket.emit("error", {
          message: "MQTT client not connected",
          brokerId: this.broker._id,
        });
      }
    }
  }

  publish(topic, message) {
    if (!this.client) {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} not initialized for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      if (this.socket) {
        this.socket.emit("error", {
          message: "MQTT client not initialized",
          brokerId: this.broker._id,
        });
      }
      return;
    }
    if (!this.client.connected) {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} cannot publish to ${topic}: not connected (status: ${this.connectionStatus}) for ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      if (this.socket) {
        this.socket.emit("error", {
          message: "MQTT client not connected",
          brokerId: this.broker._id,
        });
      }
      return;
    }
    console.log(`[User: ${this.userId}] MQTT client ${this.clientId} publishing to topic ${topic} on ${this.brokerUrl} (Broker ID: ${this.broker._id}):`);
    console.log(`[User: ${this.userId}] Message Content: ${message}`);
    this.client.publish(topic, message, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[User: ${this.userId}] MQTT client ${this.clientId} publish error for topic ${topic} on ${this.brokerUrl} (Broker ID: ${this.broker._id}): ${err.message}`);
        if (this.socket) {
          this.socket.emit("error", {
            message: `Publish error: ${err.message}`,
            brokerId: this.broker._id,
          });
        }
      } else {
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} successfully published to ${topic} on ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
        if (this.socket) {
          this.socket.emit("published", { topic, brokerId: this.broker._id });
        }
      }
    });
  }

  disconnect() {
    if (this.client) {
      this.connectionStatus = "disconnected";
      this.retryAttempts = 0;
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} disconnecting (status: ${this.connectionStatus}) from ${this.brokerUrl} (Broker ID: ${this.broker._id})`);
      this.client.end(true);
      this.client = null;
      if (this.socket) {
        this.socket.emit("mqtt_status", { brokerId: this.broker._id, status: this.connectionStatus });
        console.log(`[User: ${this.userId}] Emitted mqtt_status for broker ${this.broker._id}: ${this.connectionStatus} to socket ${this.socket.id}`);
      }
    }
  }

  updateSocket(newSocket) {
    console.log(`[User: ${this.userId}] Updating socket for MQTT client ${this.clientId} (Broker ID: ${this.broker._id}) from ${this.socket?.id || "none"} to ${newSocket.id}`);
    this.socket = newSocket;
  }

  isConnected() {
    return this.client && this.client.connected && this.connectionStatus === "connected";
  }
}

module.exports = MqttHandler;