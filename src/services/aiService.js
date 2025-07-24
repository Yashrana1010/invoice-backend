const { detectIntent, generateConversationalResponse, getPendingExtractedData, clearPendingExtractedData, displayInvoiceData } = require('./langchainService');
const { extractFinancialData } = require('./extractionService');
const logger = require('../utils/logger');

async function processMessage(message, userId, conversationId, accessToken) {
  logger.info(`Processing message: "${message}" for user ${userId}`);

  // Step 1: Detect intent using LangChain with Gemini
  const intent = await detectIntent(message, userId, conversationId);

  logger.info(`Detected intent: ${intent.intent} with confidence: ${intent.confidence}`);

  if(!intent || intent.intent !== 'DISPLAY_INVOICE') 
  {// Step 2: Extract financial data using regex (as backup)
  const extractedData = extractFinancialData(message);

  // Step 3: Merge AI entities with regex extraction (prioritize AI entities)
  let mergedData = {
    ...extractedData,
    ...intent.entities
  };

  // Step 4: If intent is CREATE_INVOICE or RECORD_TRANSACTION and required fields are missing,
  // try to merge in pending extracted data from conversation context
  if (
    (intent.intent === 'CREATE_INVOICE' || intent.intent === 'RECORD_TRANSACTION') &&
    (!mergedData.client || !mergedData.amount)
  ) {
    const pending = getPendingExtractedData(userId, conversationId || 'default');
    if (pending) {
      mergedData = {
        ...pending,
        ...mergedData // user message takes precedence if present
      };
    }
    logger.info(`Merged data: ${JSON.stringify(mergedData)}`);
  }};


  // Step 5: Process based on intent
  let response;
  switch (intent.intent) {
    case 'CREATE_INVOICE':
      response = await handleInvoiceCreation(mergedData, userId, message, conversationId);
      // Clear pending extracted data after use
      clearPendingExtractedData(userId, conversationId || 'default');
      break;
    case 'RECORD_TRANSACTION':
      response = await handleTransactionRecord(mergedData, userId, message, conversationId);
      clearPendingExtractedData(userId, conversationId || 'default');
      break;
    case 'GENERATE_BALANCE_SHEET':
      response = await handleBalanceSheetGeneration(userId, conversationId);
      break;
    case 'DISPLAY_INVOICE':
      // Use LangChain to generate conversational response for invoice display
      response = await displayInvoiceData(message, userId, conversationId,  accessToken);
      break;
    default:
      response = await handleGeneralInquiry(message, userId, conversationId);
  }

  return response;
}

async function handleInvoiceCreation(data, userId, originalMessage, conversationId) {
  try {
    // Enhanced validation with helpful prompts
    const missingFields = [];

    if (!data.client) {
      missingFields.push("client name");
    }

    if (!data.amount || isNaN(parseFloat(data.amount))) {
      missingFields.push("amount");
    }

    if (missingFields.length > 0) {
      // Use LangChain for interactive follow-up
      const followUpMessage = `I need a bit more information to create your invoice. Please provide the ${missingFields.join(' and ')}. For example: "Create an invoice for John Smith for $500 for consulting services"`;

      return {
        message: followUpMessage,
        data: null,
        requiresMoreInfo: true,
        missingFields,
        conversational: true
      };
    }

    const amount = parseFloat(data.amount);
    const invoiceData = {
      client: data.client,
      amount: amount,
      description: data.description || 'Professional services',
      date: data.date || new Date().toISOString().split('T')[0],
      userId
    };

    const invoice = await createInvoice(invoiceData);

    return {
      message: `✅ Perfect! I've created your invoice successfully!\n\n📄 **Invoice #${invoice.invoice_number}**\n👤 **Client:** ${data.client}\n💰 **Amount:** $${amount.toFixed(2)}\n📝 **Description:** ${invoiceData.description}\n\nIs there anything else you'd like me to help you with? 😊`,
      data: invoice,
      success: true,
      conversational: true
    };
  } catch (error) {
    logger.error('Invoice creation error:', error);
    return {
      message: `❌ I couldn't create the invoice: ${error.message}. Let me know if you'd like to try again with different information! 🤔`,
      data: null,
      error: true,
      conversational: true
    };
  }
}

async function handleTransactionRecord(data, userId, originalMessage, conversationId) {
  try {
    const missingFields = [];

    if (!data.amount || isNaN(parseFloat(data.amount))) {
      missingFields.push("amount");
    }

    if (!data.description) {
      missingFields.push("description");
    }

    if (missingFields.length > 0) {
      return {
        message: `I need more details to record this transaction. Please provide the ${missingFields.join(' and ')}. For example: "I spent $50 on office supplies" or "Record $1000 income from consulting" 💼`,
        data: null,
        requiresMoreInfo: true,
        missingFields,
        conversational: true
      };
    }

    const amount = parseFloat(data.amount);

    // Determine transaction type from context
    let type = 'expense'; // default
    if (/\b(income|received|earned|revenue|payment)\b/i.test(originalMessage) || amount > 0) {
      type = 'income';
    } else if (/\b(expense|spent|paid|cost|bought)\b/i.test(originalMessage)) {
      type = 'expense';
    }

    const transactionData = {
      amount: Math.abs(amount),
      description: data.description,
      date: data.date || new Date().toISOString().split('T')[0],
      type: type,
      userId
    };

    const transaction = await recordTransaction(transactionData);

    const emoji = type === 'income' ? '💰' : '💸';
    const typeText = type === 'income' ? 'Income' : 'Expense';

    return {
      message: `✅ Great! I've recorded your transaction successfully!\n\n${emoji} **${typeText}:** $${Math.abs(amount).toFixed(2)}\n📝 **Description:** ${data.description}\n📅 **Date:** ${transactionData.date}\n\nWould you like to record another transaction or see your financial summary? 📊`,
      data: transaction,
      success: true,
      conversational: true
    };
  } catch (error) {
    logger.error('Transaction recording error:', error);
    return {
      message: `❌ I couldn't record the transaction: ${error.message}. Please try again with the amount and description! 🔄`,
      data: null,
      error: true,
      conversational: true
    };
  }
}

async function handleBalanceSheetGeneration(userId, conversationId) {
  try {
    const balanceSheet = await generateBalanceSheet(userId);

    const message = `📊 **Here's Your Financial Summary!**

💰 **Total Revenue:** $${balanceSheet.totalRevenue.toFixed(2)}
💸 **Total Expenses:** $${balanceSheet.totalExpenses.toFixed(2)}
📈 **Net Income:** $${balanceSheet.netIncome.toFixed(2)}

📄 **Invoice Summary:**
• Total Invoices: ${balanceSheet.totalInvoices}
• Outstanding Invoices: ${balanceSheet.outstandingInvoices}
• Outstanding Amount: $${balanceSheet.outstandingAmount.toFixed(2)}

📝 **Total Transactions:** ${balanceSheet.totalTransactions}

📅 Generated on: ${new Date(balanceSheet.generatedAt).toLocaleDateString()}

Looking good! 🎉 Would you like me to create a new invoice or record a transaction?`;

    return {
      message,
      data: balanceSheet,
      success: true,
      conversational: true
    };
  } catch (error) {
    logger.error('Balance sheet generation error:', error);
    return {
      message: "❌ I couldn't generate your balance sheet right now. Please try again in a moment! ⏰",
      data: null,
      error: true,
      conversational: true
    };
  }
}

async function handleGeneralInquiry(message, userId, conversationId) {
  // Use LangChain for conversational response only, no fallback
  const response = await generateConversationalResponse(message, userId, conversationId);
  return {
    message: response,
    data: null,
    success: true,
    conversational: true
  };
}

module.exports = {
  processMessage
};
