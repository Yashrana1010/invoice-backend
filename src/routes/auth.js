require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const logger = require('../utils/logger');
const passport = require('passport');
const XeroStrategy = require('passport-xero-oauth2').Strategy;

const router = express.Router();

// Demo user data (replace with database in production)
const demoUser = {
  id: '1',
  email: 'demo@example.com',
  password: '$2a$10$8K1p/a0dUZRfTMUSbM6tKeSGCnhI0z1kO5QrJ2YfJYl2JU7S5KJ/6', // demo123
  name: 'Demo User'
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

// Login endpoint
router.post('/login', validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    logger.info(`Login attempt for email: ${email}`);

    // In production, query database
    if (email !== demoUser.email) {
      logger.warn(`Login failed - user not found: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // For demo purposes, also allow plain text password comparison
    let isValidPassword = false;

    // Try bcrypt comparison first
    try {
      isValidPassword = await bcrypt.compare(password, demoUser.password);
    } catch (bcryptError) {
      logger.warn('Bcrypt comparison failed, trying plain text for demo');
    }

    // Fallback to plain text for demo (remove in production)
    if (!isValidPassword && password === 'demo123') {
      isValidPassword = true;
      logger.info('Demo login using plain text password');
    }

    if (!isValidPassword) {
      logger.warn(`Login failed - invalid password for: ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: demoUser.id, email: demoUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`Login successful for: ${email}`);

    res.json({
      token,
      user: {
        id: demoUser.id,
        email: demoUser.email,
        name: demoUser.name
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    id: demoUser.id,
    email: demoUser.email,
    name: demoUser.name
  });
});

module.exports = router;