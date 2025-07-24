const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const { PromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');
const { getInvoices } = require('./xeroService');
const logger = require('../utils/logger');
require('dotenv').config();

// Initialize Gemini model with correct configuration
const model = new ChatGoogleGenerativeAI({
  modelName: process.env.GEMINI_MODEL,
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.1,
  maxOutputTokens: 2000,
  streaming: false,
  verbose: false,
});

// Store connection status
let modelConnectionWorking = null;

// Conversation memory storage (in production, use Redis or database)
const conversationMemory = new Map();

function parseGeminiResponse(response) {
  try {
    // Remove markdown code blocks if present
    let cleanedResponse = response.trim();

    // Remove ```json and ``` markers
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Parse the cleaned JSON
    return JSON.parse(cleanedResponse.trim());
  } catch (error) {
    logger.error('JSON parsing error:', error.message);
    logger.error('Raw response:', response);
    throw new Error(`Failed to parse AI response as JSON: ${error.message}`);
  }
}

// Test model connection on startup
async function testModelConnection() {
  try {
    logger.info('Testing Gemini model connection...');
    const testResponse = await model.invoke([
      new HumanMessage("Say 'Connection successful' if you can read this.")
    ]);
    logger.info('Gemini model connection successful');
    return true;
  } catch (error) {
    logger.error('Gemini model connection failed:', error.message);
    throw new Error('Gemini model connection failed');
  }
}

// Initialize connection test
testModelConnection()
  .then(status => {
    modelConnectionWorking = status;
  })
  .catch(error => {
    modelConnectionWorking = false;
    logger.error('Model connection initialization failed:', error.message);
  });

// Intent detection prompt template
const intentDetectionPrompt = PromptTemplate.fromTemplate(`
You are a financial assistant AI. Analyze the user's message and determine their intent.

Possible intents:
- CREATE_INVOICE: User wants to create an invoice (keywords: invoice, bill, charge, create invoice, send invoice)
- RECORD_TRANSACTION: User wants to record a transaction (keywords: transaction, expense, income, record, spent, received, paid)
- GENERATE_BALANCE_SHEET: User wants to see a balance sheet (keywords: balance, sheet, summary, report, overview, total)
- UPLOAD_DOCUMENT: User wants to upload a document for processing (keywords: upload, document, file, process, analyze)
- DISPLAY_INVOICE: User wants to get an invoice from database by invoiceId (keywords: show invoice, show bill, get invoice, display invoice)
- GENERAL_INQUIRY: General questions about finance, help requests, or unclear intent

IMPORTANT: Always respond with valid JSON in this exact format:
{{
  "intent": "INTENT_NAME",
  "confidence": 0.95,
  "entities": {{
    "client": "client name if mentioned or null",
    "amount": "amount if mentioned (number only) or null",
    "description": "description if mentioned or null",
    "date": "date if mentioned (YYYY-MM-DD format) or null"
  }},
  "reasoning": "Brief explanation of why this intent was chosen"
}}

Examples:
- "Create an invoice for John for $500" -> CREATE_INVOICE
- "I spent $50 on office supplies" -> RECORD_TRANSACTION
- "Show me my balance sheet" -> GENERATE_BALANCE_SHEET
- "How do I create invoices?" -> GENERAL_INQUIRY
- "get invoice with invoiceId ab78dbe6-b3cf-4420-986d-24a041e3ec0f" -> DISPLAY_INVOICE

User message: {message}

Previous conversation context: {context}
`);

// General conversation prompt template
const conversationPrompt = PromptTemplate.fromTemplate(`
You are a helpful and friendly AI assistant for an Finance management system. You can help users with:

✅ Creating invoices: "Create an invoice for [client] for $[amount]"
✅ Recording transactions: "I spent $[amount] on [description]"
✅ Viewing balance sheets: "Show me my balance sheet"
✅ Uploading documents: Users can upload invoice documents for automatic data extraction
✅ Show invoice: "get invoice with invoiceId ab78dbe6-b3cf-4420-986d-24a041e3ec0f"

Guidelines:
- Be conversational, helpful, and engaging
- Use emojis to make responses more friendly
- Provide specific examples when explaining features
- If users ask unclear questions, ask clarifying questions
- Keep responses concise but informative
- Remember previous conversation context

Previous conversation: {context}

User message: {message}

Respond in a helpful and engaging way:
`);

// Invoice data extraction prompt template
const invoiceExtractionPrompt = PromptTemplate.fromTemplate(`
You are an expert at extracting structured data from invoice documents. 
Analyze the provided invoice text and extract the following information:

1. Invoice Number
2. Invoice Date  
3. Due Date
4. Client/Customer Name
5. Client Address
6. Total Amount
7. Subtotal
8. Tax Amount
9. Description of Services/Items
10. Vendor/Company Name
11. Payment Terms

IMPORTANT: Respond ONLY with valid JSON in this exact format (no extra text before or after):
{{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null", 
  "dueDate": "YYYY-MM-DD or null",
  "clientName": "string or null",
  "clientAddress": "string or null",
  "totalAmount": "number or null",
  "subtotal": "number or null", 
  "taxAmount": "number or null",
  "description": "string or null",
  "vendorName": "string or null",
  "paymentTerms": "string or null",
  "currency": "string or USD",
  "confidence": 0.95,
  "extractedFields": ["field1", "field2"]
}}

Important:
- Use null for missing information
- Convert dates to YYYY-MM-DD format
- Extract only numeric values for amounts (no currency symbols)
- Be accurate and conservative in extraction
- Set confidence based on how clear the information is
- Do NOT include any text outside the JSON response

Invoice text to analyze:
{documentText}
`);

const invoiceChatDisplayPrompt = PromptTemplate.fromTemplate(`
You are a helpful assistant that displays invoice data in a clean and readable chat format.

Here is the invoice text:
{invoiceJson}
`);

const extractIdPrompt = PromptTemplate.fromTemplate(`
You are an intelligent assistant designed to extract ID values from user messages.

Analyze the message below and extract a valid ID if one is present.

Message:
"{userMessage}"

Instructions:
- Extract only the ID (e.g., a UUID, numeric ID, alphanumeric ID, etc.)
- Do NOT include any text before or after the ID
- If multiple IDs are present, return only the first one found
- If no ID is found, return null
- Do NOT return anything other than the ID(s) or null

Examples:
Input: "Can you fetch details for invoice ID INV-0001?"
Output: "INV-0001"

Input: "Here are the IDs: 123456, 987654"
Output: "123456"

Input: "Hey there!"
Output: null
`);

// Create LangChain chains
const intentChain = RunnableSequence.from([
  intentDetectionPrompt,
  model,
  new StringOutputParser(),
]);

const conversationChain = RunnableSequence.from([
  conversationPrompt,
  model,
  new StringOutputParser(),
]);

const invoiceExtractionChain = RunnableSequence.from([
  invoiceExtractionPrompt,
  model,
  new StringOutputParser(),
]);

const InvoiceDisplayChain = RunnableSequence.from([
  invoiceChatDisplayPrompt,
  model,
  new StringOutputParser(),
]);

const extractIdChain = RunnableSequence.from([
  extractIdPrompt,
  model,
  new StringOutputParser(),
]);

// Fallback intent detection (rule-based)
function detectIntentFallback(message) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('invoice') && (lowerMessage.includes('create') || lowerMessage.includes('make'))) {
    return {
      intent: 'CREATE_INVOICE',
      confidence: 0.8,
      entities: { client: null, amount: null, description: null, date: null },
      reasoning: 'Fallback: Detected invoice creation keywords'
    };
  }

  if (lowerMessage.includes('transaction') || lowerMessage.includes('expense') || lowerMessage.includes('spent')) {
    return {
      intent: 'RECORD_TRANSACTION',
      confidence: 0.8,
      entities: { client: null, amount: null, description: null, date: null },
      reasoning: 'Fallback: Detected transaction keywords'
    };
  }

  if (lowerMessage.includes('balance') || lowerMessage.includes('sheet') || lowerMessage.includes('summary')) {
    return {
      intent: 'GENERATE_BALANCE_SHEET',
      confidence: 0.8,
      entities: { client: null, amount: null, description: null, date: null },
      reasoning: 'Fallback: Detected balance sheet keywords'
    };
  }

  if (lowerMessage.includes('show') && lowerMessage.includes('invoice')) {
    return {
      intent: 'DISPLAY_INVOICE',
      confidence: 0.8,
      entities: { client: null, amount: null, description: null, date: null },
      reasoning: 'Fallback: Detected display invoice keywords'
    };
  }

  return {
    intent: 'GENERAL_INQUIRY',
    confidence: 0.7,
    entities: { client: null, amount: null, description: null, date: null },
    reasoning: 'Fallback: Default to general inquiry'
  };
}

// Enhanced intent detection with conversation context
async function detectIntent(message, userId, conversationId = 'default') {
  try {
    logger.info(`Detecting intent for message: "${message}"`);

    // Check if model connection is working
    if (modelConnectionWorking === false) {
      logger.info('Using fallback intent detection due to model connection issues');
      return detectIntentFallback(message);
    }

    // Get conversation context
    const context = getConversationContext(userId, conversationId);

    const response = await intentChain.invoke({
      message: message,
      context: context
    });

    logger.info(`Raw intent response: ${response}`);

    // Parse JSON response
    const parsed = parseGeminiResponse(response);

    // Validate response structure
    if (!parsed.intent || !parsed.confidence || !parsed.entities) {
      throw new Error('Invalid response structure from Gemini');
    }

    // Store in conversation memory
    addToConversationMemory(userId, conversationId, {
      type: 'intent_detection',
      message: message,
      intent: parsed.intent,
      timestamp: new Date()
    });

    return parsed;
  } catch (error) {
    logger.error('Intent detection error:', error.message);

    // Update connection status if it's a model error
    if (error.message.includes('GoogleGenerativeAI Error') || error.message.includes('404 Not Found')) {
      modelConnectionWorking = false;
      logger.warn('Marking Gemini model as unavailable due to API error');
    }

    // Fallback to rule-based detection
    logger.info('Using fallback intent detection');
    return detectIntentFallback(message);
  }
}

// Function to build dynamic finance manager prompt
function buildFinanceManagerPrompt({ context, message }) {
  return `
You are a finance manager AI assistant for an Finance management system.

${context ? `Previous conversation:\n${context}\n` : ''}

User message: ${message}

Reply as a knowledgeable, concise, and helpful finance manager.
`;
}

// Generate fallback response
function generateFallbackResponse(message) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
    return "Hello! I'm your finance assistant. I can help you create invoices, record transactions, and manage your financial data. How can I assist you today? 😊";
  }

  if (lowerMessage.includes('help')) {
    return "I can help you with:\n✅ Creating invoices\n✅ Recording transactions\n✅ Viewing balance sheets\n✅ Processing uploaded documents\n\nWhat would you like to do?";
  }

  return "I'm currently experiencing some technical difficulties, but I'm here to help! Please try rephrasing your request or contact support if the issue persists.";
}

// Replace conversationChain with a dynamic prompt
async function generateConversationalResponse(message, userId, conversationId = 'default') {
  try {
    logger.info(`Generating conversational response for: "${message}"`);

    if (modelConnectionWorking === false) {
      logger.info('Using fallback conversation response due to model connection issues');
      return generateFallbackResponse(message);
    }

    const context = getConversationContext(userId, conversationId);

    // Build the prompt dynamically
    const prompt = buildFinanceManagerPrompt({ context, message });

    // Use the model directly with the dynamic prompt
    const response = await model.invoke([new HumanMessage(prompt)]);

    // Store in conversation memory
    addToConversationMemory(userId, conversationId, {
      type: 'conversation',
      userMessage: message,
      botResponse: response.content,
      timestamp: new Date()
    });

    return response.content;
  } catch (error) {
    logger.error('Conversation generation error:', error.message);

    if (error.message.includes('GoogleGenerativeAI Error') || error.message.includes('404 Not Found')) {
      modelConnectionWorking = false;
      logger.warn('Marking Gemini model as unavailable due to API error');
    }

    return generateFallbackResponse(message);
  }
}

// Improved JSON extraction function
function extractValidJson(str) {
  try {
    // First, try to parse the entire string
    return JSON.parse(str);
  } catch (error) {
    // If that fails, try to find and extract valid JSON
    const trimmed = str.trim();

    // Look for JSON object boundaries
    const firstBrace = trimmed.indexOf('{');
    if (firstBrace === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBrace; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // Found complete JSON object
            const jsonStr = trimmed.substring(firstBrace, i + 1);
            try {
              return JSON.parse(jsonStr);
            } catch (parseError) {
              logger.error('Failed to parse extracted JSON:', parseError.message);
              return null;
            }
          }
        }
      }
    }

    // If we reach here, no complete JSON was found
    return null;
  }
}

// Invoice data extraction using LangChain (improved)
async function extractInvoiceDataWithLangChain(documentText, userId, conversationId = 'default') {
  try {
    logger.info('Starting LangChain-powered invoice data extraction');

    if (!documentText || documentText.trim().length < 10) {
      throw new Error('Document text is too short or empty');
    }

    if (modelConnectionWorking === false) {
      throw new Error('Gemini model is unavailable');
    }

    const response = await invoiceExtractionChain.invoke({
      documentText: documentText
    });

    // Clean the response by removing markdown code blocks
    let cleanedResponse = response.trim();

    // Remove triple backticks and language indicators
    if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```[a-zA-Z]*\s*/, '');
      cleanedResponse = cleanedResponse.replace(/```$/, '');
      cleanedResponse = cleanedResponse.trim();
    }

    // Try to extract valid JSON
    const extractedData = extractValidJson(cleanedResponse);

    if (!extractedData) {
      logger.error('Failed to extract valid JSON from response');
      throw new Error('Gemini did not return valid JSON. Raw response: ' + cleanedResponse);
    }

    // Validate that we have the expected structure
    if (typeof extractedData !== 'object' || extractedData === null) {
      throw new Error('Extracted data is not a valid object');
    }

    const cleanedData = validateAndCleanExtractedData(extractedData);

    // Store in conversation memory
    addToConversationMemory(userId, conversationId, {
      type: 'document_extraction',
      message: documentText,
      intent: 'UPLOAD_DOCUMENT',
      timestamp: new Date()
    });

    logger.info(`Successfully extracted invoice data with confidence: ${cleanedData.confidence}`);
    return cleanedData;
  } catch (error) {
    logger.error('LangChain invoice extraction error:', error.message);
    throw new Error('AI extraction failed: ' + error.message);
  }
}

// Display invoice data
async function displayInvoiceData(message, userId, conversationId = 'default', accessToken) {
  try {
    logger.info(`[displayInvoiceData] Generating display invoice response for: "${message}"`);

    // Check if model connection is working
    if (modelConnectionWorking === false) {
      logger.info('[displayInvoiceData] Using fallback response due to model connection issues');
      return generateFallbackResponse(message);
    }

    const context = getConversationContext(userId, conversationId);

    const invoiceId = await extractIdChain.invoke({
      userMessage: message,
      context: context
    });

    console.log("Extracted invoiceId:", invoiceId);

    if (!invoiceId || invoiceId === 'null') {
      return "I couldn't find an invoice ID in your message. Please provide a valid invoice ID.";
    }

    const documentText = await getInvoices(invoiceId, accessToken);
    console.log("Fetched invoice data:", documentText);

    const response = await InvoiceDisplayChain.invoke({
      invoiceJson: JSON.stringify(documentText),
      context: context
    });

    // Store in conversation memory
    addToConversationMemory(userId, conversationId, {
      type: 'conversation',
      userMessage: message,
      botResponse: response,
      timestamp: new Date()
    });

    return response;
  } catch (error) {
    logger.error(`[displayInvoiceData] Error generating response: ${error.message}`);

    // Update connection status if it's a model error
    if (error.message.includes('GoogleGenerativeAI Error') || error.message.includes('404 Not Found')) {
      modelConnectionWorking = false;
      logger.warn('[displayInvoiceData] Marking Gemini model as unavailable due to API error');
    }

    // Fallback response
    return generateFallbackResponse(message);
  }
}

// Conversation memory management
function getConversationContext(userId, conversationId) {
  const key = `${userId}-${conversationId}`;
  const memory = conversationMemory.get(key) || [];

  // Return last 5 interactions for context
  return memory.slice(-5).map(item => {
    if (item.type === 'conversation') {
      return `User: ${item.userMessage}\nBot: ${item.botResponse}`;
    } else if (item.type === 'intent_detection') {
      return `User intent: ${item.intent} for message: "${item.message}"`;
    }
    return '';
  }).join('\n\n');
}

function addToConversationMemory(userId, conversationId, item) {
  const key = `${userId}-${conversationId}`;
  const memory = conversationMemory.get(key) || [];

  memory.push(item);

  // Keep only last 20 items to prevent memory bloat
  if (memory.length > 20) {
    memory.splice(0, memory.length - 20);
  }

  conversationMemory.set(key, memory);
}

function clearConversationMemory(userId, conversationId) {
  const key = `${userId}-${conversationId}`;
  conversationMemory.delete(key);
}

// Pending extracted data management
function setPendingExtractedData(userId, conversationId, data) {
  const key = `${userId}-${conversationId}`;
  const memory = conversationMemory.get(key) || [];
  // Remove any previous pending extracted data
  const filtered = memory.filter(item => item.type !== 'pending_extracted_data');
  filtered.push({
    type: 'pending_extracted_data',
    data,
    timestamp: new Date()
  });
  conversationMemory.set(key, filtered);
}

function getPendingExtractedData(userId, conversationId) {
  const key = `${userId}-${conversationId}`;
  const memory = conversationMemory.get(key) || [];
  const pending = memory.find(item => item.type === 'pending_extracted_data');
  return pending ? pending.data : null;
}

function clearPendingExtractedData(userId, conversationId) {
  const key = `${userId}-${conversationId}`;
  const memory = conversationMemory.get(key) || [];
  const filtered = memory.filter(item => item.type !== 'pending_extracted_data');
  conversationMemory.set(key, filtered);
}

// Validation and cleaning of extracted data
function validateAndCleanExtractedData(data) {
  const cleaned = { ...data };

  // Validate and clean amounts
  ['totalAmount', 'subtotal', 'taxAmount'].forEach(field => {
    if (cleaned[field] !== null && cleaned[field] !== undefined) {
      const amount = parseFloat(cleaned[field]);
      cleaned[field] = isNaN(amount) ? null : amount;
    }
  });

  // Validate dates
  ['invoiceDate', 'dueDate'].forEach(field => {
    if (cleaned[field] && !isValidDate(cleaned[field])) {
      cleaned[field] = null;
    }
  });

  // Ensure confidence is between 0 and 1
  if (cleaned.confidence > 1) cleaned.confidence = 1;
  if (cleaned.confidence < 0) cleaned.confidence = 0;

  // Set default currency
  if (!cleaned.currency) cleaned.currency = 'USD';

  // Ensure extractedFields is an array
  if (!Array.isArray(cleaned.extractedFields)) {
    cleaned.extractedFields = [];
  }

  return cleaned;
}

function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

// Function to check model availability
function isModelAvailable() {
  return modelConnectionWorking !== false;
}

module.exports = {
  detectIntent,
  generateConversationalResponse,
  extractInvoiceDataWithLangChain,
  clearConversationMemory,
  testModelConnection,
  isModelAvailable,
  model,
  setPendingExtractedData,
  getPendingExtractedData,
  clearPendingExtractedData,
  displayInvoiceData
};