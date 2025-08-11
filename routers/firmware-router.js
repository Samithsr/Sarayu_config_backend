const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const router = express.Router();

// Configure multer storage with file type validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../firmware");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log("Created firmware directory at:", dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".bin") {
      cb(null, true);
    } else {
      cb(new Error("Only .bin files are allowed"));
    }
  },
});

// Upload endpoint
router.post("/upload", upload.single("file"), (req, res) => {
  console.log("Upload request received:", req.file);
  if (!req.file) {
    console.error("No file uploaded");
    return res.status(400).json({ success: false, message: "Please upload a file" });
  }
  console.log("File uploaded:", req.file.path);
  res.status(200).json({ success: true, message: "File uploaded successfully!" });
});

// Get all versions endpoint with dynamic IP
router.get("/get-all-versions", (req, res) => {
  try {
    const { ip } = req.query; // Get IP from query parameter
    const host = "13.201.135.43"; // Updated to AWS IP
    const dir = path.join(__dirname, "../firmware");
    const data = fs.readdirSync(dir, "utf-8");
    const result = data.map((item) => `http://${host}:5000/api/updates/${item}`);
    console.log("Fetched firmware versions for IP", host, ":", result);
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Error fetching versions:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download endpoint
router.get("/download/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "../firmware", filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ success: false, message: "File not found" });
    }

    // Validate file extension
    const ext = path.extname(filename).toLowerCase();
    if (ext !== ".bin") {
      console.error(`Invalid file type: ${filename}`);
      return res.status(400).json({ success: false, message: "Only .bin files are allowed" });
    }

    // Set headers for file download
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition"); // Expose for CORS

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", (error) => {
      console.error("File stream error:", error);
      res.status(500).json({ success: false, message: "Error streaming file" });
    });
    fileStream.pipe(res);

    console.log(`Serving file for download: ${filename}`);
  } catch (error) {
    console.error("Download error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete endpoint
router.delete("/delete/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "../firmware", filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ success: false, message: "File not found" });
    }

    // Validate file extension
    const ext = path.extname(filename).toLowerCase();
    if (ext !== ".bin") {
      console.error(`Invalid file type: ${filename}`);
      return res.status(400).json({ success: false, message: "Only .bin files are allowed" });
    }

    // Delete the file
    fs.unlinkSync(filePath);
    console.log(`File deleted: ${filePath}`);
    res.status(200).json({ success: true, message: `File ${filename} deleted successfully` });
  } catch (error) {
    console.error("Delete error:", error.message);
    res.status(500).json({ success: false, message: `Delete error: ${error.message}` });
  }
});

// Publish endpoint
router.post("/publish", async (req, res) => {
  const { brokerIp, topic, message, mqttUsername, mqttPassword } = req.body;

  if (!brokerIp || !topic || !message || !mqttUsername || !mqttPassword) {
    return res.status(400).json({ success: false, message: "Broker IP, topic, message, username, and password are required" });
  }

  // Validate brokerIp format (basic IP address check)
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (!ipRegex.test(brokerIp)) {
    return res.status(400).json({ success: false, message: "Invalid broker IP format" });
  }

  // Validate message is a URL
  const urlRegex = /^http:\/\/[a-zA-Z0-9.-]+:\d+\/api\/updates\/.*\.bin$/;
  if (!urlRegex.test(message)) {
    return res.status(400).json({ success: false, message: "Invalid firmware URL format" });
  }

  try {
    let client;
    // Check if an authenticated client exists for this broker
    for (const [clientId, broker] of req.connectedBrokers) {
      // Safely check if broker.url exists and includes brokerIp
      if (broker.url && broker.url.includes(brokerIp) && broker.client && !broker.client.reconnecting) {
        client = broker.client;
        break;
      }
    }

    // If no existing client or client is disconnected, create a new one
    if (!client || client.ended || client.reconnecting) {
      const clientId = `publish_${Math.random().toString(16).slice(3)}`;
      client = mqtt.connect(`mqtt://${brokerIp}:1883`, {
        clientId,
        username: mqttUsername,
        password: mqttPassword,
        connectTimeout: 5000,
        reconnectPeriod: 1000, // Enable automatic reconnection with 1-second delay
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        client.on("connect", () => {
          console.log(`Connected to MQTT broker at ${brokerIp}:1883 for publish (clientId: ${clientId})`);
          // Store the client in connectedBrokers
          req.connectedBrokers.set(clientId, { client, url: `mqtt://${brokerIp}:1883` });
          resolve();
        });
        client.on("error", (error) => {
          console.error(`MQTT connection error for ${brokerIp}:`, error.message);
          client.end();
          reject(error);
        });
        client.on("close", () => {
          console.log(`MQTT client disconnected for ${brokerIp} (clientId: ${clientId})`);
          // Do not remove from connectedBrokers here to allow reconnection
        });
      });
    }

    // Publish message
    await new Promise((resolve, reject) => {
      client.publish(topic, message, { qos: 0 }, (error) => {
        if (error) {
          console.error(`Publish error for ${brokerIp} (topic: ${topic}):`, error.message);
          reject(error);
        } else {
          console.log(`Published URL "${message}" to topic "${topic}" on broker ${brokerIp}:1883`);
          resolve();
        }
      });
    });

    res.status(200).json({ success: true, message: `Published URL "${message}" successfully` });
  } catch (error) {
    console.error("Publish error:", error.message);
    res.status(500).json({ success: false, message: `Publish error: ${error.message}` });
  }
});

// Serve static files with CORS
router.use("/updates", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  console.log("Dirname : ", __dirname);
  next();
}, express.static(path.join(__dirname, "../firmware")));

module.exports = router;