const logger = require('../utils/logger');

// Enhanced regex patterns for extracting financial data
const patterns = {
  amount: /\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
  date: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}-\d{2}-\d{2})/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  clientName: /(?:for|to|from|client|customer)\s+([A-Za-z](?:[a-zA-Z\s]{1,28}[A-Za-z])?)/gi,
  invoiceNumber: /(?:invoice|inv)[\s#]*(\d+)/gi,
  percentage: /(\d+(?:\.\d+)?)\s*%/g
};

function extractFinancialData(message) {
  const data = {};
  
  try {
    logger.info(`Extracting financial data from: "${message}"`);

    // Extract amounts with better cleaning
    const amounts = message.match(patterns.amount);
    if (amounts && amounts.length > 0) {
      // Take the largest amount found (likely the main transaction amount)
      const cleanAmounts = amounts.map(amt => parseFloat(amt.replace(/[$,]/g, '')));
      data.amount = Math.max(...cleanAmounts).toString();
      logger.info(`Extracted amount: ${data.amount}`);
    }

    // Extract dates with validation
    const dates = message.match(patterns.date);
    if (dates && dates.length > 0) {
      data.date = normalizeDate(dates[0]);
      logger.info(`Extracted date: ${data.date}`);
    }

    // Enhanced client name extraction
    const clientMatches = [...message.matchAll(patterns.clientName)];
    if (clientMatches && clientMatches.length > 0) {
      // Clean and validate client name
      let clientName = clientMatches[0][1].trim();
      clientName = clientName.replace(/\s+/g, ' '); // normalize spaces
      
      // Validate client name (should be reasonable length and contain letters)
      if (clientName.length >= 2 && clientName.length <= 50 && /[a-zA-Z]/.test(clientName)) {
        data.client = clientName;
        logger.info(`Extracted client: ${data.client}`);
      }
    }

    // Extract email addresses
    const emails = message.match(patterns.email);
    if (emails && emails.length > 0) {
      data.email = emails[0];
      logger.info(`Extracted email: ${data.email}`);
    }

    // Extract invoice numbers
    const invoiceMatches = [...message.matchAll(patterns.invoiceNumber)];
    if (invoiceMatches && invoiceMatches.length > 0) {
      data.invoiceNumber = invoiceMatches[0][1];
      logger.info(`Extracted invoice number: ${data.invoiceNumber}`);
    }

    // Enhanced description extraction
    data.description = extractDescription(message, data);
    if (data.description) {
      logger.info(`Extracted description: ${data.description}`);
    }

    logger.info(`Final extracted data: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    logger.error('Data extraction error:', error);
    return {};
  }
}

function normalizeDate(dateString) {
  try {
    logger.info(`Normalizing date: ${dateString}`);
    
    // Handle different date formats
    let date;
    
    // Try parsing MM/DD/YYYY or MM-DD-YYYY
    if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(dateString)) {
      const parts = dateString.split(/[\/\-]/);
      if (parts.length === 3) {
        let year = parseInt(parts[2]);
        if (year < 100) year += 2000; // Convert 2-digit year to 4-digit
        
        date = new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]));
      }
    } 
    // Try parsing YYYY-MM-DD
    else if (/\d{4}-\d{2}-\d{2}/.test(dateString)) {
      date = new Date(dateString);
    }
    // Fallback to Date constructor
    else {
      date = new Date(dateString);
    }
    
    if (isNaN(date.getTime())) {
      logger.warn(`Invalid date: ${dateString}`);
      return null;
    }
    
    const normalized = date.toISOString().split('T')[0];
    logger.info(`Normalized date: ${normalized}`);
    return normalized;
  } catch (error) {
    logger.error(`Date normalization error for "${dateString}":`, error);
    return null;
  }
}

function extractDescription(message, extractedData) {
  try {
    // Start with the original message
    let cleanMessage = message;
    
    // Remove common command phrases
    const removePatterns = [
      /create\s+(?:an?\s+)?invoice/gi,
      /send\s+(?:an?\s+)?invoice/gi,
      /record\s+(?:a\s+)?transaction/gi,
      /i\s+spent/gi,
      /i\s+paid/gi,
      /expense\s+for/gi,
      /transaction\s+for/gi
    ];

    removePatterns.forEach(pattern => {
      cleanMessage = cleanMessage.replace(pattern, '');
    });

    // Remove extracted client name and amount
    if (extractedData.client) {
      const clientPattern = new RegExp(`\\b${extractedData.client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      cleanMessage = cleanMessage.replace(clientPattern, '');
    }
    
    if (extractedData.amount) {
      const amountPattern = new RegExp(`\\$?${extractedData.amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      cleanMessage = cleanMessage.replace(amountPattern, '');
    }

    // Remove prepositions and clean up
    cleanMessage = cleanMessage.replace(/\b(for|to|from|on|of|the|a|an|and|or)\b/gi, ' ');
    cleanMessage = cleanMessage.replace(/\s+/g, ' ').trim();

    // Look for service descriptions with context
    const servicePatterns = [
      { pattern: /\b(consulting|consultation)\b/gi, service: 'Consulting services' },
      { pattern: /\b(development|programming|coding)\b/gi, service: 'Development services' },
      { pattern: /\b(design|designing)\b/gi, service: 'Design services' },
      { pattern: /\b(marketing|advertising)\b/gi, service: 'Marketing services' },
      { pattern: /\b(legal|attorney|lawyer)\b/gi, service: 'Legal services' },
      { pattern: /\b(accounting|bookkeeping)\b/gi, service: 'Accounting services' },
      { pattern: /\b(maintenance|repair)\b/gi, service: 'Maintenance services' },
      { pattern: /\b(training|education)\b/gi, service: 'Training services' },
      { pattern: /\b(writing|content)\b/gi, service: 'Writing services' },
      { pattern: /\b(office\s+supplies|supplies)\b/gi, service: 'Office supplies' },
      { pattern: /\b(travel|transportation)\b/gi, service: 'Travel expenses' },
      { pattern: /\b(software|subscription)\b/gi, service: 'Software/Subscription' }
    ];

    for (const { pattern, service } of servicePatterns) {
      if (pattern.test(message)) {
        return service;
      }
    }

    // If we have a reasonable description from cleaning, use it
    if (cleanMessage.length >= 3 && cleanMessage.length <= 100) {
      // Capitalize first letter
      return cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1).toLowerCase();
    }

    // Default fallback
    return 'Professional services';
  } catch (error) {
    logger.error('Description extraction error:', error);
    return 'Professional services';
  }
}

// Additional utility functions for specific extractions
function extractClientInfo(message) {
  const clientInfo = {};
  
  // More sophisticated client name extraction
  const clientPatterns = [
    /(?:client|customer|for|to)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+owes|\s+paid|\s+invoice)/g
  ];

  for (const pattern of clientPatterns) {
    const match = message.match(pattern);
    if (match) {
      clientInfo.name = match[1];
      break;
    }
  }

  return clientInfo;
}

function extractInvoiceDetails(message) {
  const details = {};
  
  // Extract due date
  const dueDatePattern = /due\s+(?:on\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi;
  const dueDateMatch = message.match(dueDatePattern);
  if (dueDateMatch) {
    details.dueDate = normalizeDate(dueDateMatch[0].replace(/due\s+(?:on\s+)?/gi, ''));
  }

  // Extract payment terms
  const termsPattern = /(?:net\s+)?(\d+)\s+days?/gi;
  const termsMatch = message.match(termsPattern);
  if (termsMatch) {
    details.paymentTerms = `Net ${termsMatch[0].match(/\d+/)[0]} days`;
  }

  return details;
}

module.exports = {
  extractFinancialData,
  extractClientInfo,
  extractInvoiceDetails
};
