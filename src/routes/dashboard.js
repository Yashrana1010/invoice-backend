const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get dashboard summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get balance sheet data
    const balanceSheet = await generateBalanceSheet(userId);
    
    // Get recent transactions
    const recentTransactions = await getTransactions(userId, { limit: 5 });
    
    // Get pending invoices
    const pendingInvoices = await getInvoices(userId, { status: 'pending' });
    
    const summary = {
      totalRevenue: balanceSheet.totalRevenue,
      totalInvoices: balanceSheet.totalInvoices,
      pendingInvoices: pendingInvoices.length,
      netIncome: balanceSheet.netIncome,
      recentTransactions: recentTransactions.map(txn => ({
        description: txn.description,
        amount: txn.amount,
        date: txn.date,
        client: txn.client || 'Internal'
      }))
    };
    
    res.json(summary);
  } catch (error) {
    logger.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get balance sheet
router.get('/balance-sheet', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const balanceSheet = await generateBalanceSheet(userId);
    res.json(balanceSheet);
  } catch (error) {
    logger.error('Balance sheet error:', error);
    res.status(500).json({ error: 'Failed to generate balance sheet' });
  }
});

module.exports = router;
