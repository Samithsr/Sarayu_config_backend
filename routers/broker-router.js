const express = require("express");
const router = express.Router();
const Broker = require("../models/broker-model");


  
// 1.  Handle POST request to /brokers
router.post('/brokers', async (req, res) => {
    try {
      const { brokerIp, portNumber, username, password, label } = req.body;
      const broker = new Broker({ brokerIp, portNumber, username, password, label });
      await broker.save();
      res.status(201).json({
        success: true,
        data: broker,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to create broker',
        error: error.message,
      });
    }
  });

// 2. Handle GET request to show all brokers
router.get('/brokers', async (req, res) => {
    try {
      const brokers = await Broker.find();
      res.status(200).json({
        success: true,
        data: brokers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch brokers',
        error: error.message,
      });
    }
  });
  
  
  module.exports = router;