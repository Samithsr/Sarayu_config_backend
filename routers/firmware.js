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

// Get all versions endpoint
router.get("/get-all-versions", (req, res) => {
  try {
    const host = "localhost"; // Use localhost for local development
    const dir = path.join(__dirname, "../firmware");
    const data = fs.readdirSync(dir, "utf-8");
    const result = data.map((item) => `http://${host}:5000/api/updates/${encodeURIComponent(item)}`);
    console.log("Fetched firmware versions for IP", host, ":", result);
    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Error fetching versions:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch versions" });
  }
});

// Download endpoint
router.get("/download/:filename", (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(__dirname, "../firmware", filename);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ success: false, message: "File not found" });
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext !== ".bin") {
      console.error(`Invalid file type: ${filename}`);
      return res.status(400).json({ success: false, message: "Only .bin files are allowed" });
    }

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/octet-stream");

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    console.log(`Serving file for download: ${filename}`);
  } catch (error) {
    console.error("Download error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Publish endpoint
router.post("/publish", async (req, res) => {
  const { brokerIp, topic, message } = req.body;

  console.log("Received publish request:", { brokerIp, topic, message }); // Detailed logging

  if (!brokerIp || !topic || !message) {
    console.error("Missing required fields:", { brokerIp, topic, message });
    return res.status(400).json({ success: false, message: "Broker IP, topic, and message are required" });
  }

  // Validate brokerIp format
  const ipRegex = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (!ipRegex.test(brokerIp) && brokerIp !== "localhost") {
    console.error("Invalid broker IP format:", brokerIp);
    return res.status(400).json({ success: false, message: "Invalid broker IP format" });
  }

  // Validate message is a URL
  const urlRegex = /^http:\/\/(localhost|[\w.-]+):5000\/api\/updates\/.+.bin$/;
  if (!urlRegex.test(message)) {
    console.error(`Invalid firmware URL format: "${message}" (expected format: http://<host>:5000/api/updates/<filename>.bin)`);
    return res.status(400).json({ success: false, message: "Invalid firmware URL format" });
  }

  try {
    // Connect to MQTT broker with timeout
    const client = mqtt.connect(`mqtt://${brokerIp}:1883`, { connectTimeout: 5000 });

    client.on("connect", () => {
      console.log(`Connected to MQTT broker at ${brokerIp}:1883`);

      // Publish message
      client.publish(topic, message, { qos: 0 }, (error) => {
        if (error) {
          console.error("Publish error:", error.message);
          client.end();
          return res.status(500).json({ success: false, message: `Failed to publish message: ${error.message}` });
        }

        console.log(`Published URL "${message}" to topic "${topic}" on broker ${brokerIp}`);
        client.end();
        res.status(200).json({ success: true, message: `Published URL "${message}" successfully` });
      });
    });

    client.on("error", (error) => {
      console.error(`MQTT connection error for ${brokerIp}:1883:`, error.message);
      client.end();
      res.status(500).json({ success: false, message: `MQTT connection error: ${error.message}` });
    });

  } catch (error) {
    console.error("Publish error:", error.message);
    res.status(500).json({ success: false, message: `Publish error: ${error.message}` });
  }
});

// Serve static files
router.use("/updates", express.static(path.join(__dirname, "../firmware")));

module.exports = router;