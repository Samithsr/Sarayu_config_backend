const express = require('express');
const router = express.Router();
const User = require('../models/user-model');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middlewares/auth-middleware');
const restrictToadmin = require('../middlewares/restrictToadmin');

router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate request body
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Verify password
    const isMatch = await user.verifypass(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = user.generateToken();

    // Log the login event
    console.log(`[Auth] User logged in: ${user._id}, role: ${user.roles}`);

    // Return token and user details
    res.status(200).json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        roles: user.roles,
      },
    });
  } catch (error) {
    console.error(`[Auth] Signin error: ${error.message}`);
    res.status(500).json({
      message: 'Server error during signin',
      error: error.message,
    });
  }
});

// New route to fetch all users (admin only)
router.get('/users', authMiddleware, restrictToadmin('admin'), async (req, res) => {
  try {
    console.log(`[User: ${req.userId}] Fetching all users`);
    const users = await User.find({}, '_id email'); // Fetch only _id and email for the dropdown
    console.log(`[User: ${req.userId}] Found ${users.length} users`);
    res.status(200).json(users);
  } catch (error) {
    console.error(`[User: ${req.userId}] Error fetching users: ${error.message}`);
    res.status(500).json({
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
});

module.exports = router;