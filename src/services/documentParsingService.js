const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// Supported file types
const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

async function parseDocument(filePath, mimeType) {
  try {
    logger.info(`Parsing document: ${filePath}, type: ${mimeType}`);
    
    if (!SUPPORTED_TYPES[mimeType]) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    const fileBuffer = await fs.readFile(filePath);
    let extractedText = '';

    switch (SUPPORTED_TYPES[mimeType]) {
      case 'pdf':
        extractedText = await parsePDF(fileBuffer);
        break;
      case 'txt':
        extractedText = fileBuffer.toString('utf8');
        break;
      case 'image':
        // For images, we'll use OpenAI Vision API later
        extractedText = await parseImageWithAI(fileBuffer);
        break;
      default:
        throw new Error(`Parser not implemented for type: ${mimeType}`);
    }

    // Clean up the file
    await fs.unlink(filePath);
    
    logger.info(`Successfully extracted ${extractedText.length} characters from document`);
    return extractedText;
  } catch (error) {
    logger.error(`Document parsing error: ${error.message}`);
    
    // Clean up file on error
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      logger.warn(`Failed to cleanup file: ${unlinkError.message}`);
    }
    
    throw error;
  }
}

async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    logger.error(`PDF parsing error: ${error.message}`);
    throw new Error('Failed to parse PDF file');
  }
}

async function parseImageWithAI(buffer) {
  // This would use OpenAI Vision API or similar OCR service
  // For now, return a placeholder
  logger.info('Image parsing not yet implemented - using placeholder');
  return 'Image content detected - OCR processing would extract text here';
}

function validateFile(file) {
  const errors = [];
  
  // Check file size (10MB limit)
  if (file.size > 10 * 1024 * 1024) {
    errors.push('File size must be less than 10MB');
  }
  
  // Check file type
  if (!SUPPORTED_TYPES[file.mimetype]) {
    errors.push(`Unsupported file type: ${file.mimetype}. Supported types: PDF`);
  }
  
  return errors;
}

function getSupportedTypes() {
  return Object.keys(SUPPORTED_TYPES);
}

module.exports = {
  parseDocument,
  validateFile,
  getSupportedTypes,
  SUPPORTED_TYPES
};
