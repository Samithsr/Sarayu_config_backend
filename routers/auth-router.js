const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/user-model");


//signup
router.post("/signup", async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log("email signup:",email)
      console.log("password signup:",password)
      const user = await User.create({ email, password });
      const token = await user.generateToken();
      res.status(201).json({ success: true, token });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

//signin  
router.post("/signin", async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log(req.body)
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(400)
          .json({ success: false, message: "Email not registered" });
      }
      console.log(user)
      console.log("sending password:",password)
      const validate = await user.verifypass(password);
      if (!validate) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid password" });
      }
      console.log(validate)
      const token = await user.generateToken();
      res.status(200).json({ success: true, token });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });


  module.exports = router;


