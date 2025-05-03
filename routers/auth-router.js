const express = require("express");
const router = express.Router();
const User = require("../models/user-model");

router.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }
    const user = await User.create({ email, password });
    const token = await user.generateToken();
    res.status(201).json({
      token,
      user: { _id: user._id, email: user.email },
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Email not registered" });
    }
    const validate = await user.verifypass(password);
    if (!validate) {
      return res.status(400).json({ message: "Invalid password" });
    }
    const token = await user.generateToken();
    res.status(200).json({
      token,
      user: { _id: user._id, email: user.email },
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;