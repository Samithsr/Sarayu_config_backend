// models/broker-model.js
const mongoose = require("mongoose");

const BrokerSchema = new mongoose.Schema({
  brokerIp: {
    type: String,
    required: [true, "Broker IP is required"],
  },
  portNumber: {
    type: String,
    required: [true, "Port number is required"],
  },
  username: {
    type: String,
    required: [true, "Username is required"],
  },
  password: {
    type: String,
    required: [true, "Password is required"],
  },
  label:{
    type: String,
    required: [true, "label is required"],
  }
}, { timestamps: true });

module.exports = mongoose.model("Broker", BrokerSchema);