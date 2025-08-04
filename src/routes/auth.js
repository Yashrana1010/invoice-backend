require('dotenv').config();
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const TokenStore = require('../services/tokenStore');

const router = express.Router();

// Get current user from Xero token
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = req.user;
    const userId = user.email || user.sub || user.id;

    // Extract user info from token
    const userInfo = {
      id: userId,
      email: user.email || userId,
      name: user.name || `${user.given_name || ''} ${user.family_name || ''}`.trim() || userId,
      given_name: user.given_name,
      family_name: user.family_name,
      xero_userid: user.xero_userid
    };

    logger.info(`User info retrieved for: ${userId}`);
    res.json(userInfo);
  } catch (error) {
    logger.error('Error getting user info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check authentication status
router.get('/status', authenticateToken, (req, res) => {
  try {
    const userId = req.user.email || req.user.sub || req.user.id;
    const hasXeroTokens = TokenStore.hasValidTokens(userId);

    res.json({
      authenticated: true,
      hasXeroTokens,
      user: {
        id: userId,
        email: req.user.email || userId,
        name: req.user.name || userId
      }
    });
  } catch (error) {
    logger.error('Error checking auth status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;