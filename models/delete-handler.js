const Broker = require("../models/broker-model");

const deleteHandler = async (req, res, io) => {
  const { id } = req.params; // brokerId
  const userId = req.userId; // From authMiddleware

  try {
    console.log(`[User: ${userId}] Attempting to delete broker ${id}`);
    const broker = await Broker.findOne({ _id: id, userId });
    if (!broker) {
      console.error(`[User: ${userId}] Broker ${id} not found or not owned by user`);
      return res.status(404).json({ message: "Broker not found" });
    }

    await Broker.deleteOne({ _id: id, userId });
    console.log(`[User: ${userId}] Broker ${id} deleted successfully`);

    // Emit broker_deleted event to all sockets in user room
    io.to(userId).emit("broker_deleted", { brokerId: id });
    console.log(`[User: ${userId}] Emitted broker_deleted event for broker ${id}`);

    return res.status(200).json({ message: "Broker deleted successfully" });
  } catch (error) {
    console.error(`[User: ${userId}] Error deleting broker ${id}: ${error.message}`);
    return res.status(500).json({ message: "Failed to delete broker" });
  }
};

module.exports = { deleteHandler };

