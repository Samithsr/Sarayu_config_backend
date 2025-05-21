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
    type: String,
    required: true,
  },
  assignedUserId: {
    type: String,
    default: null,
  },
  username: {
    type: String,
    default: '',
  },
  password: {
    type: String,
    default: '',
  },
  connectionTime: {
    type: Date,
    default: null, // Set to null initially, updated when connected
  },
});

module.exports = mongoose.model('Broker', brokerSchema);
