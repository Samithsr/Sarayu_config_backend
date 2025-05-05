const mongoose = require("mongoose");

const BrokerSchema = new mongoose.Schema({
  brokerIp: {
    type: String,
    required: [true, "Broker IP is required"],
    trim: true,
    validate: {
      validator: function (v) {
        return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^localhost$/.test(v);
      },
      message: "Invalid IP address format",
    },
  },
  username: {
    type: String,
    trim: true,
  },
  password: {
    type: String,
    trim: true,
  },
  label: {
    type: String,
    required: [true, "Label is required"],
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "User ID is required"],
  },
}, { timestamps: true });

module.exports = mongoose.model("Broker", BrokerSchema);