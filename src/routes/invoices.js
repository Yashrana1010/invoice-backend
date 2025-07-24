const express = require('express');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Get all invoices
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, limit } = req.query;
    
    const invoices = await getInvoices(userId, { status, limit: parseInt(limit) || 50 });
    res.json(invoices);
  } catch (error) {
    logger.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get all transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type, limit } = req.query;
    
    const transactions = await getTransactions(userId, { type, limit: parseInt(limit) || 50 });
    res.json(transactions);
  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

module.exports = router;
