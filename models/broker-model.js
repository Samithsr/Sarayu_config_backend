// broker-model.js
const mongoose = require('mongoose');

const brokerSchema = new mongoose.Schema({
  brokerIp: {
    type: String,
    required: false,
  },
  portNumber: {
    type: Number,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  topic: {
    type: String,
    required: true,
    default: '',
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
    default: null,
  },
  lastValidationError: {
    type: String,
    default: null,
  },
});

module.exports = mongoose.model('Broker', brokerSchema);
