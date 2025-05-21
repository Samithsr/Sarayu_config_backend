const mongoose = require("mongoose");

const ConfigurationSchema = new mongoose.Schema({
  configurations: {
    type: Array,
    required: [true, "Configurations array is required"],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: [true, "User ID is required"],
  },
  brokerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Broker",
    required: [true, "Broker ID is required"],
  },
  topicName: {
    type: String,
    required: [true, "Topic name is required"],
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model("Configuration", ConfigurationSchema);

