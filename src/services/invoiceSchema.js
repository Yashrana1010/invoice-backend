const { z } = require("zod");

const trackingSchema = z.object({
  TrackingCategoryID: z.string().default("e2f2f732-e92a-4f3a-9c4d-ee4da0182a13"),
  Name: z.string().default("Region"),
  Option: z.string().default("North"),
});

const lineItemSchema = z.object({
  ItemCode: z.string().default("item-new"),
  Description: z.string().default("Invoice item"),
  Quantity: z.string().default("1"),
  UnitAmount: z.string().default("0.00"),
  TaxType: z.string().default("OUTPUT"),
  TaxAmount: z.string().default("0.00"),
  LineAmount: z.string().default("0.00"),
  AccountCode: z.string().default("200"),
  Tracking: z.array(trackingSchema).optional().default([])
});

const contactSchema = z.object({
  ContactID: z.string().optional(),
  Name: z.string().optional()
}).refine(data => data.ContactID || data.Name, {
  message: "Either ContactID or Name must be provided",
  path: ["Contact"]
});

const xeroInvoiceSchema = z.object({
  Type: z.string().default("ACCREC"),
  Contact: contactSchema,
  DateString: z.string().default("2009-09-08T00:00:00"),
  DueDateString: z.string().default("2009-09-08T00:00:00"),
  ExpectedPaymentDate: z.string().default("2009-09-08T00:00:00"),
  InvoiceNumber: z.string().default("INV-00065"),
  Reference: z.string().optional().default(""),
  BrandingThemeID: z.string().default("34efa745-7238-4ead-b95e-1fe6c816adbe"),
  Url: z.string().url().default("https://example.com/invoice"),
  CurrencyCode: z.string().length(3).optional(),
  Status: z.string().default("SUBMITTED"),
  LineAmountTypes: z.string().default("Inclusive"),
  SubTotal: z.string().default("0.00"),
  TotalTax: z.string().default("0.00"),
  Total: z.string().default("0.00"),
  LineItems: z.array(lineItemSchema).default([
    {
      ItemCode: "item-new",
      Description: "Invoice item",
      Quantity: "1",
      UnitAmount: "0.00",
      TaxType: "OUTPUT",
      TaxAmount: "0.00",
      LineAmount: "0.00",
      AccountCode: "200",
      Tracking: []
    }
  ])
});


function mapToXeroInvoiceSchema(data) {
  const today = new Date().toISOString().split('T')[0];

  // Generate random invoice number if not provided
  const generateInvoiceNumber = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
    return `INV-${randomNum}`;
  };

  // Calculate total amount properly
  const totalAmount = parseFloat(data.totalAmount || data.amount || 0);
  const taxAmount = parseFloat(data.taxAmount || 0);
  const subtotal = totalAmount - taxAmount;

  // Use provided currency (will be overridden by organization's base currency in xeroService)
  const currency = data.currency || "INR";

  // Handle line items properly
  let lineItems = [];
  if (data.lineItems && Array.isArray(data.lineItems) && data.lineItems.length > 0) {
    lineItems = data.lineItems.map(item => ({
      Description: item.description || "Service/Product",
      Quantity: (item.quantity || 1).toString(),
      UnitAmount: (item.unitAmount || 0).toString(),
      TaxType: item.taxType || "OUTPUT",
      TaxAmount: (item.taxAmount || 0).toString(),
      LineAmount: (item.lineAmount || item.unitAmount || 0).toString(),
      AccountCode: item.accountCode || "200",
      Tracking: item.tracking || []
    }));
  } else {
    // Create a default line item if none exist
    lineItems = [{
      Description: data.description || "Invoice item",
      Quantity: "1",
      UnitAmount: totalAmount.toString(),
      TaxType: "OUTPUT",
      TaxAmount: taxAmount.toString(),
      LineAmount: totalAmount.toString(),
      AccountCode: "200",
      Tracking: []
    }];
  }

  const invoiceData = {
    Type: "ACCREC",
    Contact: {
      Name: data.clientName || "Unknown Client",
      ContactID: data.clientId || undefined
    },
    DateString: data.invoiceDate || today,
    DueDateString: data.dueDate || today,
    ExpectedPaymentDate: data.dueDate || today,
    InvoiceNumber: data.invoiceNumber || generateInvoiceNumber(),
    Reference: data.reference || "",
    BrandingThemeID: "34efa745-7238-4ead-b95e-1fe6c816adbe",
    Url: "https://example.com/invoice",
    Status: "SUBMITTED",
    LineAmountTypes: "Inclusive",
    SubTotal: subtotal.toString(),
    TotalTax: taxAmount.toString(),
    Total: totalAmount.toString(),
    LineItems: lineItems
  };

  // Only add currency if specified and not a fallback
  if (data.currency && data.currency !== 'SKIP_CURRENCY') {
    invoiceData.CurrencyCode = currency;
  }

  return invoiceData;
}

module.exports = { xeroInvoiceSchema, mapToXeroInvoiceSchema };