const mongoose = require("mongoose");

const BrokerSchema = new mongoose.Schema({
  brokerIp: {
    type: String,
    required: [true, "Broker IP is required"],
  },
  portNumber: {
    type: Number,
    default: 1883,
  },
  username: {
    type: String,
  },
  password: {
    type: String,
  },
  label: {
    type: String,
    required: [true, "Label is required"],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "User ID is required"],
  },
  connectionStatus: {
    type: String,
    enum: ['connected', 'disconnected', 'connecting', 'error'],
    default: 'disconnected',
  },
}, { timestamps: true });

module.exports = mongoose.model("Broker", BrokerSchema);