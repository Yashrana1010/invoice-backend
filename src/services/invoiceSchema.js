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
  ContactID: z.string().optional().default("b9794c5e-36be-4502-bb11-9f8cd2541c0a"),
  Name: z.string().optional()
}).refine(data => data.ContactID || data.Name, {
  message: "Either ContactID or Name must be provided",
  path: ["Contact"]
});

const xeroInvoiceSchema = z.object({
  Type: z.string().default("ACCREC"),
  Contact: contactSchema.default({ ContactID: "b9794c5e-36be-4502-bb11-9f8cd2541c0a" }),
  DateString: z.string().default("2009-09-08T00:00:00"),
  DueDateString: z.string().default("2009-09-08T00:00:00"),
  ExpectedPaymentDate: z.string().default("2009-09-08T00:00:00"),
  InvoiceNumber: z.string().default("INV-00065"),
  Reference: z.string().optional().default(""),
  BrandingThemeID: z.string().default("34efa745-7238-4ead-b95e-1fe6c816adbe"),
  Url: z.string().url().default("https://example.com/invoice"),
  CurrencyCode: z.string().length(3).default("INR"),
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
  return {
    DateString: data.invoiceDate || today,
    DueDateString: data.dueDate || today,
    ExpectedPaymentDate: data.dueDate || today,
    InvoiceNumber: data.invoiceNumber || "INV-000065",
    Reference: "",
    BrandingThemeID: "34efa745-7238-4ead-b95e-1fe6c816adbe",
    Url: "https://example.com/invoice",
    CurrencyCode: data.currency || "INR",
    Status: "SUBMITTED",
    LineAmountTypes: "Inclusive",
    SubTotal: (data.subtotal != null ? data.subtotal : 0).toString(),
    TotalTax: (data.taxAmount != null ? data.taxAmount : 0).toString(),
    Total: (data.totalAmount != null ? data.totalAmount : 0).toString(),
    LineItems: [
      {
        Description: data.description || "Invoice item",
        Quantity: "1",
        UnitAmount: (data.subtotal != null ? data.subtotal : 0).toString(),
        TaxType: "OUTPUT",
        TaxAmount: (data.taxAmount != null ? data.taxAmount : 0).toString(),
        LineAmount: (data.subtotal != null ? data.subtotal : 0).toString(),
        AccountCode: "200",
        Tracking: []
      }
    ]
  };
}

module.exports = { xeroInvoiceSchema, mapToXeroInvoiceSchema };