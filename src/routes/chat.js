const express = require('express');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { processMessage } = require('../services/aiService');
const { detectIntent } = require('../services/langchainService');
const TokenStore = require('../services/tokenStore');
const logger = require('../utils/logger');

const router = express.Router();

const messageSchema = z.object({
  message: z.string().min(1).max(1000),
  conversationId: z.string().optional()
});

// Process chat message
router.post('/message',authenticateToken, validateRequest(messageSchema), async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    // Extract user ID from token - use email if available, otherwise use sub or id
    const userId = req.user.email || req.user.sub || req.user.id;

    if (!userId) {
      logger.warn('No user identifier found in token');
      return res.status(400).json({
        error: 'Invalid token - no user identifier found'
      });
    }

    logger.info(`Processing message from user ${userId}: ${message}`);

    // Get stored Xero access token for the user
    const xeroAccessToken = TokenStore.getAccessToken(userId);

    if (!xeroAccessToken) {
      logger.warn(`No Xero access token found for user ${userId}`);
      return res.status(401).json({
        error: 'Xero authentication required',
        message: 'Please authenticate with Xero first to create invoices.',
        requiresXeroAuth: true
      });
    }

    const response = await processMessage(message, userId, conversationId, xeroAccessToken);

    console.log("Response from processMessage:", response);
    res.json(response);
  } catch (error) {
    logger.error('Chat message processing error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: 'Your Xero token may have expired or is invalid. Please re-authenticate.',
    });
  }
});

// Get conversation history
router.get('/history/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.email || req.user.sub || req.user.id;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid token - no user identifier found' });
    }

    // In production, fetch from database
    const history = [];

    res.json({ messages: history });
  } catch (error) {
    logger.error('Chat history error:', error);
    res.status(500).json({ error: 'Failed to retrieve chat history' });
  }
});

// POST /chat/set-xero-token - Manually set Xero token for testing
router.post('/set-xero-token', authenticateToken, async (req, res) => {
  try {
    const { access_token, refresh_token, expires_in, tenant_id } = req.body;
    const userId = req.user.email || req.user.sub || req.user.id;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid token - no user identifier found' });
    }

    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required' });
    }

    const tokensToStore = {
      access_token,
      refresh_token,
      expires_in: expires_in || 1800,
      tenant_id: tenant_id || process.env.XERO_TENANT_ID
    };

    TokenStore.storeUserTokens(userId, tokensToStore);

    res.json({
      success: true,
      message: `Xero token stored for user ${userId}`,
      hasValidTokens: TokenStore.hasValidTokens(userId)
    });
  } catch (error) {
    logger.error('Set Xero token error:', error);
    res.status(500).json({ error: 'Failed to store Xero token' });
  }
});

module.exports = router;
