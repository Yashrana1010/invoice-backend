const express = require('express');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { processMessage } = require('../services/aiService');
const { detectIntent } = require('../services/langchainService');
const logger = require('../utils/logger');

const router = express.Router();

const messageSchema = z.object({
  message: z.string().min(1).max(1000),
  conversationId: z.string().optional()
});

// Process chat message
router.post('/message', authenticateToken, validateRequest(messageSchema), async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    const userId = req.user.userId;

    logger.info(`Processing message from user ${userId}: ${message}`);

    const authHeader = req.headers.authorization || req.headers.Authorization;
    const xeroAccessToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    const response = await processMessage(message, userId, conversationId,  xeroAccessToken);
    
    console.log("Response from processMessage:", response);
    res.json(response);
  } catch (error) {
    logger.error('Chat message processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      message: 'Sorry, I encountered an error. Please try again.'
    });
  }
});

// Get conversation history
router.get('/history/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.userId;

    // In production, fetch from database
    const history = [];

    res.json({ messages: history });
  } catch (error) {
    logger.error('Failed to fetch conversation history:', error);
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

module.exports = router;
