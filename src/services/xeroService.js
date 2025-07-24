const axios = require('axios');
const logger = require('../utils/logger');
const {xeroInvoiceSchema, mapToXeroInvoiceSchema} = require('./invoiceSchema');



const XERO_TENANT_ID = process.env.XERO_TENANT_ID || "c8b88426-261c-409a-8258-d9c3fb365d76";

async function createInvoice(invoiceData, accessToken, xeroTenantId) {
  try {
    console.log("Creating invoice in Xero...");
    // Validate input
    // console.log("Invoice data before validation:", invoiceData);
    const validatedData = xeroInvoiceSchema.parse(mapToXeroInvoiceSchema(invoiceData));
    const response = await axios.post("https://api.xero.com/api.xro/2.0/Invoices", 
      {Invoices: [validatedData]},
      {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'xero-tenant-id': xeroTenantId, // Required by Xero for all API calls
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to create invoice: ${response.statusText}`);
    }

    logger.info(`Invoice created successfully: ${response.data?.Invoices?.[0]?.InvoiceID || 'No ID found'}`);
    return validatedData; // Return the validated invoice data
  } catch (error) {
    if (error.name === 'ZodError') {
      logger.error('Invoice validation error:', error.errors);
      throw new Error('Invalid invoice data');
    }

    logger.error('Xero API error:', error);
    throw new Error('Failed to create invoice');
  }
}

async function getInvoices(invoiceId, accessToken){
  try { 
    const response = await axios.get(`https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'xero-tenant-id': XERO_TENANT_ID,
      }
    });

    if (response.status !== 200 || !response.data || !response.data.Invoices || !response.data.Invoices[0]) {
      throw new Error(`Invoice not found or API error: ${response.statusText}`);
    }

    return response.data.Invoices[0];
  } catch (error) {
    logger.error('Xero API error:', error);
    throw error;
  }
}

async function getTenantId(accessToken) {
  console.log("Fetching tenant ID");
  try {
    const response = await axios.get("https://api.xero.com/connections", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      }
    });

    if (response.data && response.data.length > 0) {
      return response.data[0].tenantId;
    } else {
      throw new Error('No tenant found');
    }
  } catch (error) {
    logger.error('Error fetching tenant ID:', error.message);
    throw error;
  }
}
 
module.exports  = { createInvoice, getTenantId, getInvoices };