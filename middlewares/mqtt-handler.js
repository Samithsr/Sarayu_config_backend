const mqtt = require("mqtt");

class MqttHandler {
  constructor(userId, broker) {
    if (!userId) {
      throw new Error("User ID is required");
    }
    if (!broker || !broker._id || !broker.brokerIp || !broker.portNumber) {
      throw new Error(`Invalid broker data: ${JSON.stringify(broker)}`);
    }

    this.userId = userId;
    this.broker = broker;
    this.client = null;
    this.clientId = `server_${userId}_${broker._id}_${Date.now()}`;
    this.brokerUrl = `mqtt://${broker.brokerIp}:${broker.portNumber || 1883}`;
    this.connectionStatus = "disconnected";
    this.connectionError = null; // Added to store last connection error
    this.retryAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
    console.log(`[User: ${this.userId}] MQTT handler initialized for ${this.clientId} (Broker ID: ${broker._id}, IP: ${broker.brokerIp})`);
  }

  isValidBrokerAddress(ip) {
    if (!ip || typeof ip !== "string" || ip.trim() === "") {
      return false;
    }
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/;
    return ip === "3.110.131.251" || ipv4Regex.test(ip) || hostnameRegex.test(ip);
  }

  async testConnection(port) {
    return new Promise((resolve) => {
      if (!this.isValidBrokerAddress(this.broker.brokerIp)) {
        console.error(`[User: ${this.userId}] Invalid broker address: ${this.broker.brokerIp} for client ${this.clientId}`);
        this.connectionError = "Invalid broker address";
        resolve(false);
        return;
      }

      const clientId = `test_${this.userId}_${Date.now()}`;
      const brokerUrl = `mqtt://${this.broker.brokerIp}:${port}`;
      const options = {
        clientId,
        username: this.broker.username || "",
        password: this.broker.password || "",
        connectTimeout: 10000,
      };

      console.log(`[User: ${this.userId}] Testing connection to ${brokerUrl} for client ${clientId}`);
      const client = mqtt.connect(brokerUrl, options);

      client.on("connect", () => {
        console.log(`[User: ${this.userId}] Test connection successful to ${brokerUrl} for client ${clientId}`);
        client.end(true);
        this.connectionError = null;
        resolve(true);
      });

      client.on("error", (err) => {
        console.error(`[User: ${this.userId}] Test connection failed to ${brokerUrl} for client ${clientId}: ${err.message}`);
        this.connectionError = err.message;
        client.end(true);
        resolve(false);
      });

      client.on("close", () => {
        if (this.connectionStatus !== "connected") {
          console.log(`[User: ${this.userId}] Test connection closed for ${brokerUrl} for client ${clientId}`);
          if (!this.connectionError) {
            this.connectionError = "Connection closed unexpectedly";
          }
          resolve(false);
        }
      });
    });
  }

  async connect() {
    this.connectionStatus = "disconnected";
    this.connectionError = null;
    this.retryAttempts = 0;
    console.log(`[User: ${this.userId}] Initiating MQTT connection for ${this.clientId} to ${this.brokerUrl}`);
    return await this.attemptConnection();
  }

  async attemptConnection() {
    return new Promise((resolve) => {
      if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} already ${this.connectionStatus} for ${this.brokerUrl}`);
        resolve(this.connectionStatus === "connected");
        return;
      }

      if (!this.isValidBrokerAddress(this.broker.brokerIp)) {
        console.error(`[User: ${this.userId}] Invalid broker address: ${this.broker.brokerIp} for client ${this.clientId}`);
        this.connectionStatus = "disconnected";
        this.connectionError = "Invalid broker address";
        resolve(false);
        return;
      }

      if (this.retryAttempts >= this.maxRetries) {
        console.error(`[User: ${this.userId}] MQTT client ${this.clientId} reached max retry attempts (${this.maxRetries}) for ${this.brokerUrl}`);
        this.disconnect();
        resolve(false);
        return;
      }

      this.connectionStatus = "connecting";
      this.retryAttempts++;
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} transitioning to ${this.connectionStatus} for ${this.brokerUrl} (attempt ${this.retryAttempts}/${this.maxRetries})`);

      const options = {
        clientId: this.clientId,
        username: this.broker.username || "",
        password: this.broker.password || "",
        reconnectPeriod: 0,
        connectTimeout: 10000,
        keepalive: 60,
      };

      this.client = mqtt.connect(this.brokerUrl, options);

      this.client.on("connect", () => {
        this.connectionStatus = "connected";
        this.connectionError = null;
        this.retryAttempts = 0;
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} connected to ${this.broker.brokerIp}:${this.broker.portNumber || 1883}`);
        resolve(true);
      });

      this.client.on("message", (topic, message) => {
        const messageStr = message.toString();
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} received message on topic ${topic} from ${this.brokerUrl}: ${messageStr}`);
      });

      this.client.on("error", (err) => {
        console.error(`[User: ${this.userId}] MQTT client ${this.clientId} error (status: ${this.connectionStatus}) for ${this.brokerUrl}: ${err.message}`);
        this.connectionStatus = "disconnected";
        this.handleReconnect();
        resolve(false);
      });

      this.client.on("close", () => {
        if (this.connectionStatus !== "disconnected") {
          this.connectionStatus = "disconnected";
          console.log(`[User: ${this.userId}] MQTT client ${this.clientId} disconnected from ${this.broker.brokerIp}:${this.broker.portNumber || 1883}`);
          this.handleReconnect();
          resolve(false);
        }
      });

      this.client.on("offline", () => {
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} is offline for ${this.brokerUrl}`);
      });
    });
  }

  handleReconnect() {
    if (this.connectionStatus === "disconnected" && this.retryAttempts < this.maxRetries) {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} scheduling reconnect for ${this.brokerUrl} in ${this.retryDelay}ms (attempt ${this.retryAttempts + 1}/${this.maxRetries})`);
      setTimeout(() => {
        this.attemptConnection();
      }, this.retryDelay);
    }
  }

  subscribe(topic) {
    if (this.client && this.client.connected) {
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} subscribing to topic ${topic} for ${this.brokerUrl}`);
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          console.error(`[User: ${this.userId}] MQTT client ${this.clientId} subscription error for topic ${topic}: ${err.message}`);
        } else {
          console.log(`[User: ${this.userId}] MQTT client ${this.clientId} subscribed to ${topic}`);
        }
      });
    } else {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} cannot subscribe to ${topic}: not connected (status: ${this.connectionStatus})`);
    }
  }

  publish(topic, message) {
    if (!this.client) {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} not initialized`);
      return;
    }
    if (!this.client.connected) {
      console.error(`[User: ${this.userId}] MQTT client ${this.clientId} cannot publish to ${topic}: not connected (status: ${this.connectionStatus})`);
      return;
    }
    console.log(`[User: ${this.userId}] MQTT client ${this.clientId} publishing to topic ${topic}: ${message}`);
    this.client.publish(topic, message, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[User: ${this.userId}] MQTT client ${this.clientId} publish error for topic ${topic}: ${err.message}`);
      } else {
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} successfully published to ${topic}`);
      }
    });
  }

  disconnect() {
    if (this.client) {
      this.connectionStatus = "disconnected";
      this.retryAttempts = 0;
      console.log(`[User: ${this.userId}] MQTT client ${this.clientId} disconnecting (status: ${this.connectionStatus})`);
      this.client.end(true, () => {
        console.log(`[User: ${this.userId}] MQTT client ${this.clientId} fully disconnected`);
      });
      this.client = null;
    }
  }

  isConnected() {
    return this.client && this.client.connected && this.connectionStatus === "connected";
  }
}

module.exports = MqttHandler;