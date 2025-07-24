const { extractInvoiceDataWithLangChain } = require('./langchainService');
const logger = require('../utils/logger');

async function extractInvoiceData(documentText, userId, conversationId) {
  logger.info('Starting LangChain-powered invoice data extraction');
  // Only use LangChain/Gemini, no fallback
  return await extractInvoiceDataWithLangChain(documentText, userId, conversationId);
}

async function extractInvoiceDataAdvanced(documentText, options = {}) {
  logger.info(`Using advanced extraction with options: ${JSON.stringify(options)}`);
  return await extractInvoiceDataWithLangChain(documentText);
}

module.exports = {
  extractInvoiceData,
  extractInvoiceDataAdvanced
};
function extractInvoiceDataFallback(text) {
  logger.info('Using fallback regex extraction');

  const data = {
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    clientName: null,
    clientAddress: null,
    totalAmount: null,
    subtotal: null,
    taxAmount: null,
    description: null,
    vendorName: null,
    paymentTerms: null,
    currency: 'USD',
    confidence: 0.3,
    extractedFields: []
  };

  // Extract invoice number
  const invoiceNumMatch = text.match(/(?:invoice|inv)[\s#:]*(\w+)/i);
  if (invoiceNumMatch) {
    data.invoiceNumber = invoiceNumMatch[1];
    data.extractedFields.push('invoiceNumber');
  }

  // Extract amounts
  const amountMatches = text.match(/(?:total|amount)[\s:$]*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi);
  if (amountMatches && amountMatches.length > 0) {
    const amounts = amountMatches.map(match => {
      const num = match.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      return num ? parseFloat(num[1].replace(/,/g, '')) : null;
    }).filter(Boolean);

    if (amounts.length > 0) {
      data.totalAmount = Math.max(...amounts);
      data.extractedFields.push('totalAmount');
    }
  }

  // Extract dates
  const dateMatches = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g);
  if (dateMatches && dateMatches.length > 0) {
    data.invoiceDate = normalizeDate(dateMatches[0]);
    if (data.invoiceDate) data.extractedFields.push('invoiceDate');
  }

  return data;
}

function normalizeDate(dateString) {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Enhanced extraction for specific invoice types
async function extractInvoiceDataAdvanced(documentText, options = {}) {
  try {
    const { documentType = 'general', language = 'en' } = options;

    // Use LangChain with enhanced prompts based on options
    logger.info(`Using advanced extraction with options: ${JSON.stringify(options)}`);

    return await extractInvoiceDataWithLangChain(documentText);
  } catch (error) {
    logger.error('Advanced extraction error, falling back to basic:', error);
    return extractInvoiceData(documentText);
  }
}

module.exports = {
  extractInvoiceData,
  extractInvoiceDataAdvanced
};
