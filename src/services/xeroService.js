const axios = require('axios');
const logger = require('../utils/logger');
const TokenStore = require('./tokenStore');
const { xeroInvoiceSchema, mapToXeroInvoiceSchema } = require('./invoiceSchema');



const XERO_TENANT_ID = process.env.XERO_TENANT_ID || "c8b88426-261c-409a-8258-d9c3fb365d76";

async function getOrganisation(accessToken, xeroTenantId) {
  try {
    console.log(`Fetching organisation info for tenant: ${xeroTenantId}`);
    const response = await axios.get("https://api.xero.com/api.xro/2.0/Organisation", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'xero-tenant-id': xeroTenantId,
      }
    });

    console.log('Organisation API response status:', response.status);

    if (response.data && response.data.Organisations && response.data.Organisations[0]) {
      const org = response.data.Organisations[0];
      console.log(`Organisation found: ${org.Name}, Base Currency: ${org.BaseCurrency}`);
      return org;
    }
    console.log('No organisation data found in response');
    return null;
  } catch (error) {
    console.error('Error fetching organisation info:', error.response?.data || error.message);
    logger.error('Error fetching organisation info:', error);
    return null;
  }
}

async function createInvoice(invoiceData, accessToken, xeroTenantId, userId) {
  try {
    console.log("Creating invoice in Xero...");

    // If no tenant ID provided, try to get it from token store
    if (!xeroTenantId && userId) {
      xeroTenantId = TokenStore.getTenantId(userId);
    }

    // Fallback to environment variable
    if (!xeroTenantId) {
      xeroTenantId = process.env.XERO_TENANT_ID || "c8b88426-261c-409a-8258-d9c3fb365d76";
    }

    // Get organization info to determine base currency
    console.log("🔍 STEP 1: Fetching organization info to determine base currency...");
    console.log(`🔍 Using tenant ID: ${xeroTenantId}`);
    console.log(`🔍 Access token available: ${!!accessToken}`);

    const orgInfo = await getOrganisation(accessToken, xeroTenantId);
    console.log(`🔍 STEP 2: Organization info result:`, orgInfo);

    let invoiceDataWithCurrency;

    if (orgInfo && orgInfo.BaseCurrency) {
      console.log(`✅ Using organization base currency: ${orgInfo.BaseCurrency}`);
      invoiceDataWithCurrency = {
        ...invoiceData,
        currency: orgInfo.BaseCurrency
      };
    } else {
      console.log(`⚠️ Could not get organization info, skipping currency field`);

      // Skip currency entirely - let Xero use its default
      invoiceDataWithCurrency = {
        ...invoiceData,
        currency: 'SKIP_CURRENCY'
      };
    }

    // Validate input
    const validatedData = xeroInvoiceSchema.parse(mapToXeroInvoiceSchema(invoiceDataWithCurrency));

    logger.info('Sending invoice to Xero API', {
      tenantId: xeroTenantId,
      invoiceNumber: validatedData.InvoiceNumber,
      contactName: validatedData.Contact?.Name,
      total: validatedData.Total
    });

    const response = await axios.post("https://api.xero.com/api.xro/2.0/Invoices",
      { Invoices: [validatedData] },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'xero-tenant-id': xeroTenantId,
        }
      });

    if (response.status !== 200) {
      throw new Error(`Failed to create invoice: ${response.statusText}`);
    }

    // Get the created invoice from Xero response
    const createdInvoice = response.data?.Invoices?.[0];

    if (!createdInvoice) {
      throw new Error('No invoice data returned from Xero API');
    }

    logger.info(`Invoice created successfully in Xero`, {
      invoiceID: createdInvoice.InvoiceID,
      invoiceNumber: createdInvoice.InvoiceNumber,
      status: createdInvoice.Status,
      total: createdInvoice.Total
    });

    // Return the actual Xero invoice data
    return createdInvoice;
  } catch (error) {
    if (error.name === 'ZodError') {
      logger.error('Invoice validation error:', error.errors);
      throw new Error(`Invalid invoice data: ${error.errors.map(e => e.message).join(', ')}`);
    }

    if (error.response) {
      logger.error('Xero API error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
      throw new Error(`Xero API error: ${error.response.status} - ${error.response.statusText}`);
    }

    logger.error('Xero API error:', error);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }
}

async function getInvoices(invoiceId, accessToken) {
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

module.exports = { createInvoice, getTenantId, getInvoices, getOrganisation };