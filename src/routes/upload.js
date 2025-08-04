const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { parseDocument, validateFile } = require('../services/documentParsingService');
const { extractInvoiceData } = require('../services/invoiceExtractionService');
const { createInvoice, getTenantId } = require('../services/xeroService');
const { setPendingExtractedData } = require('../services/langchainService');
const TokenStore = require('../services/tokenStore');
const logger = require('../utils/logger');

const router = express.Router();

const XERO_TENANT_ID = process.env.XERO_TENANT_ID || "c8b88426-261c-409a-8258-d9c3fb365d76";
// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const errors = validateFile(file);
    if (errors.length > 0) {
      return cb(new Error(errors.join(', ')), false);
    }
    cb(null, true);
  }
});

// Upload and process invoice document
router.post('/invoice', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.email || req.user.sub || req.user.id;
    const { autoCreate = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid token - no user identifier found' });
    }

    logger.info(`Processing uploaded file: ${req.file.originalname} for user ${userId}`);

    // Parse the document
    const documentText = await parseDocument(req.file.path, req.file.mimetype);

    if (!documentText || documentText.trim().length < 10) {
      return res.status(400).json({
        error: 'Could not extract readable text from the document'
      });
    }

    // Extract invoice data using AI
    const extractedData = await extractInvoiceData(documentText);

    let response = {
      message: 'Document processed successfully',
      extractedData,
      documentText: documentText.substring(0, 500) + (documentText.length > 500 ? '...' : ''),
      suggestions: generateSuggestions(extractedData)
    };

    // Auto-create invoice if requested and we have enough data
    if (autoCreate && canAutoCreateInvoice(extractedData)) {
      try {
        // Get stored Xero access token for the user
        const xeroAccessToken = TokenStore.getAccessToken(userId);
        const xeroTenantId = TokenStore.getTenantId(userId);

        if (!xeroAccessToken) {
          logger.warn(`No Xero access token found for user ${userId}`);
          response.autoCreateError = 'Xero authentication required. Please authenticate with Xero first.';
        } else {
          logger.info('Extracted data for Xero invoice creation:', {
            userId,
            clientName: extractedData.clientName,
            totalAmount: extractedData.totalAmount,
            subtotal: extractedData.subtotal,
            taxAmount: extractedData.taxAmount,
            invoiceNumber: extractedData.invoiceNumber,
            lineItemsCount: extractedData.lineItems?.length || 0
          });

          const invoiceData = {
            clientName: extractedData.clientName,
            clientId: extractedData.clientId,
            invoiceDate: extractedData.invoiceDate,
            dueDate: extractedData.dueDate,
            invoiceNumber: extractedData.invoiceNumber,
            reference: extractedData.reference,
            subtotal: extractedData.subtotal,
            taxAmount: extractedData.taxAmount,
            totalAmount: extractedData.totalAmount,
            lineItems: extractedData.lineItems,
            currency: extractedData.currency
          };

          logger.info(`Creating invoice in Xero for user ${userId}`, {
            invoiceNumber: invoiceData.invoiceNumber,
            clientName: invoiceData.clientName,
            total: invoiceData.totalAmount,
            hasAccessToken: !!xeroAccessToken,
            hasTenantId: !!xeroTenantId
          });

          const invoice = await createInvoice(invoiceData, xeroAccessToken, xeroTenantId, userId);

          response.invoice = invoice;
          response.message = 'Document processed and invoice created successfully in Xero';
          response.autoCreated = true;
          response.xeroInvoiceId = invoice.InvoiceID;

          logger.info(`Invoice created successfully in Xero`, {
            userId,
            invoiceId: invoice.InvoiceID,
            invoiceNumber: invoiceData.InvoiceNumber
          });
        }
      } catch (invoiceError) {
        logger.error('Auto-create invoice error:', invoiceError);
        response.autoCreateError = `Failed to create invoice in Xero: ${invoiceError.message}`;
      }
    }

    res.json(response);
  } catch (error) {
    logger.error('Upload processing error:', error);

    // Clean up uploaded file on error
    if (req.file) {
      try {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        logger.warn('Failed to cleanup uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      error: 'Failed to process document',
      details: error.message
    });
  }
});

// Upload and extract data without creating invoice
router.post('/extract', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.email || req.user.sub || req.user.id;
    const conversationId = req.body.conversationId || 'default';
    const { createInXero = false } = req.body; // New option to create invoice immediately

    if (!userId) {
      return res.status(400).json({ error: 'Invalid token - no user identifier found' });
    }

    logger.info(`Extracting data from: ${req.file.originalname} for user ${userId}`);

    // Parse the document
    const documentText = await parseDocument(req.file.path, req.file.mimetype);

    // Extract data using AI
    const extractedData = await extractInvoiceData(documentText, userId, conversationId);

    // Save extracted data to conversation context for follow-up chat
    setPendingExtractedData(userId, conversationId, extractedData);

    let response = {
      message: 'Data extracted successfully',
      extractedData,
      documentText: documentText.substring(0, 1000) + (documentText.length > 1000 ? '...' : ''),
      fileName: req.file.originalname,
      fileSize: req.file.size,
      suggestions: generateSuggestions(extractedData)
    };

    // Optionally create invoice in Xero after extraction
    if (createInXero && canAutoCreateInvoice(extractedData)) {
      try {
        const xeroAccessToken = TokenStore.getAccessToken(userId);
        const xeroTenantId = TokenStore.getTenantId(userId);

        if (!xeroAccessToken) {
          response.xeroError = 'Xero authentication required. Please authenticate with Xero first.';
        } else {
          const invoiceData = {
            clientName: extractedData.clientName,
            clientId: extractedData.clientId,
            invoiceDate: extractedData.invoiceDate,
            dueDate: extractedData.dueDate,
            invoiceNumber: extractedData.invoiceNumber,
            reference: extractedData.reference,
            subtotal: extractedData.subtotal,
            taxAmount: extractedData.taxAmount,
            totalAmount: extractedData.totalAmount,
            lineItems: extractedData.lineItems,
            currency: extractedData.currency
          };

          const invoice = await createInvoice(invoiceData, xeroAccessToken, xeroTenantId, userId);

          response.xeroInvoice = invoice;
          response.message = 'Data extracted and invoice created successfully in Xero';
          response.xeroCreated = true;
          response.xeroInvoiceId = invoice.InvoiceID;

          logger.info(`Invoice created in Xero during extraction`, {
            userId,
            invoiceId: invoice.InvoiceID,
            fileName: req.file.originalname
          });
        }
      } catch (xeroError) {
        logger.error('Xero invoice creation error during extraction:', xeroError);
        response.xeroError = `Failed to create invoice in Xero: ${xeroError.message}`;
      }
    }

    res.json(response);
  } catch (error) {
    logger.error('Extract processing error:', error);

    if (req.file) {
      try {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        logger.warn('Failed to cleanup uploaded file:', unlinkError);
      }
    }

    res.status(500).json({
      error: 'Failed to extract data from document',
      details: error.message
    });
  }
});

// Get supported file types
router.get('/supported-types', (req, res) => {
  const { getSupportedTypes } = require('../services/documentParsingService');
  res.json({
    supportedTypes: getSupportedTypes(),
    maxFileSize: '10MB',
    description: 'Supported file types for invoice processing'
  });
});

// Create invoice in Xero from extracted data
router.post('/create-xero-invoice', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.email || req.user.sub || req.user.id;
    const { extractedData, conversationId = 'default' } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid token - no user identifier found' });
    }

    if (!extractedData) {
      return res.status(400).json({ error: 'Extracted data is required' });
    }

    logger.info(`Creating Xero invoice from extracted data for user ${userId}`);

    // Get stored Xero access token for the user
    const xeroAccessToken = TokenStore.getAccessToken(userId);
    const xeroTenantId = TokenStore.getTenantId(userId);

    if (!xeroAccessToken) {
      return res.status(401).json({
        error: 'Xero authentication required',
        message: 'Please authenticate with Xero first to create invoices.'
      });
    }

    // Validate extracted data
    if (!canAutoCreateInvoice(extractedData)) {
      return res.status(400).json({
        error: 'Insufficient data to create invoice',
        message: 'Please ensure client name and total amount are provided.',
        suggestions: generateSuggestions(extractedData)
      });
    }

    const invoiceData = {
      clientName: extractedData.clientName,
      clientId: extractedData.clientId,
      invoiceDate: extractedData.invoiceDate,
      dueDate: extractedData.dueDate,
      invoiceNumber: extractedData.invoiceNumber,
      reference: extractedData.reference,
      subtotal: extractedData.subtotal,
      taxAmount: extractedData.taxAmount,
      totalAmount: extractedData.totalAmount,
      lineItems: extractedData.lineItems,
      currency: extractedData.currency
    };

    logger.info(`Creating invoice in Xero`, {
      userId,
      invoiceNumber: invoiceData.invoiceNumber,
      clientName: invoiceData.clientName,
      total: invoiceData.totalAmount,
      lineItemsCount: invoiceData.lineItems?.length || 0
    });

    const invoice = await createInvoice(invoiceData, xeroAccessToken, xeroTenantId, userId);

    res.json({
      success: true,
      message: 'Invoice created successfully in Xero',
      invoice: invoice,
      xeroInvoiceId: invoice.InvoiceID,
      invoiceNumber: invoiceData.invoiceNumber,
      total: invoiceData.totalAmount
    });

    logger.info(`Invoice created successfully in Xero`, {
      userId,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoiceData.InvoiceNumber
    });

  } catch (error) {
    logger.error('Create Xero invoice error:', error);
    res.status(500).json({
      error: 'Failed to create invoice in Xero',
      message: error.message,
      details: error.response?.data || error.message
    });
  }
});

function canAutoCreateInvoice(extractedData) {
  return extractedData &&
    extractedData.clientName &&
    extractedData.totalAmount &&
    parseFloat(extractedData.totalAmount) > 0 &&
    (extractedData.confidence === undefined || extractedData.confidence > 0.5); // More lenient confidence threshold
}

function generateSuggestions(extractedData) {
  const suggestions = [];

  if (!extractedData.clientName) {
    suggestions.push('Client name is required to create an invoice in Xero');
  }

  if (!extractedData.totalAmount || parseFloat(extractedData.totalAmount) <= 0) {
    suggestions.push('Total amount is required and must be greater than zero');
  }

  if (!extractedData.invoiceDate) {
    suggestions.push('Consider adding the invoice date manually');
  }

  if (!extractedData.invoiceNumber) {
    suggestions.push('Invoice number will be auto-generated if not provided');
  }

  if (extractedData.confidence !== undefined && extractedData.confidence < 0.7) {
    suggestions.push('Low confidence extraction - please review all fields carefully');
  }

  if (extractedData.taxAmount && !extractedData.subtotal) {
    suggestions.push('Tax amount detected but no subtotal - please verify amounts');
  }

  if (!extractedData.lineItems || extractedData.lineItems.length === 0) {
    suggestions.push('No line items detected - a default line item will be created');
  }

  // Check if we can auto-create
  if (canAutoCreateInvoice(extractedData)) {
    suggestions.push('✅ Ready to create invoice in Xero');
  } else {
    suggestions.push('❌ Missing required data for Xero invoice creation');
  }

  return suggestions;
}

module.exports = router;
