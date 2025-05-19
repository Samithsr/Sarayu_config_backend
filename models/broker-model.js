const mongoose = require('mongoose');

const brokerSchema = new mongoose.Schema({
  brokerIp: {
    type: String,
    required: true,
  },
  portNumber: {
    type: Number,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  connectionStatus: {
    type: String,
    default: 'disconnected',
  },
  userId: {
    type: String, // The admin who created the broker
    required: true,
  },
  assignedUserId: {
    type: String, // The user assigned to this broker
    default: null,
  },
});

module.exports = mongoose.model('Broker', brokerSchema);