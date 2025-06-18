const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt"); // Add MQTT client library

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

// Get all versions endpoint
router.get("/get-all-versions", (req, res) => {
  try {
    const dir = path.join(__dirname, "../firmware");
    const data = fs.readdirSync(dir, "utf-8");
    const result = data.map((item) => `http://localhost:5000/api/updates/${item}`);
    console.log("Fetched firmware versions:", result);
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Error fetching versions:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// New publish endpoint
router.post("/publish", async (req, res) => {
  const { brokerIp, topic, message } = req.body;

  if (!brokerIp || !topic || !message) {
    return res.status(400).json({ success: false, message: "Broker IP, topic, and message are required" });
  }

  try {
    // Connect to MQTT broker
    const client = mqtt.connect(`mqtt://${brokerIp}`);
    
    client.on("connect", () => {
      console.log(`Connected to MQTT broker at ${brokerIp}`);
      
      // Publish message
      client.publish(topic, message, { qos: 0 }, (error) => {
        if (error) {
          console.error("Publish error:", error);
          client.end();
          return res.status(500).json({ success: false, message: "Failed to publish message" });
        }
        
        console.log(`Published message to topic ${topic} on broker ${brokerIp}`);
        client.end();
        res.status(200).json({ success: true, message: "Message published successfully" });
      });
    });

    client.on("error", (error) => {
      console.error("MQTT connection error:", error);
      client.end();
      res.status(500).json({ success: false, message: "MQTT connection error" });
    });

  } catch (error) {
    console.error("Publish error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Serve static files
router.use("/updates", express.static(path.join(__dirname, "../firmware")));

module.exports = router;