import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "../invoice-parser";

const baseOpenAiInvoiceText = `
OpenAI, L.L.C.
VAT ID IE4143435AH

Invoice number IA8NO7NL-0095
Date of issue August 31, 2026

Subtotal EUR 13.21
Tax EUR 0.00
Total EUR 13.21
`;

describe("OpenAI invoice parser", () => {
  it("keeps the full invoice number including suffix after the dash", () => {
    const parsed = parseInvoiceText(baseOpenAiInvoiceText, "Invoice-IA8NO7NL-0095.pdf");

    expect(parsed.invoice.supplier).toBe("OpenAI");
    expect(parsed.invoice.invoice_number).toBe("IA8NO7NL-0095");
    expect(parsed.invoice.net_amount).toBe(13.21);
    expect(parsed.invoice.tax_amount).toBe(0);
    expect(parsed.invoice.total_amount).toBe(13.21);
    expect(parsed.invoice.currency).toBe("EUR");
    expect(parsed.invoice.supplier_vat).toBe("IE4143435AH");
  });

  it("recognizes English Month DD, YYYY dates from Date of issue", () => {
    const parsed = parseInvoiceText(baseOpenAiInvoiceText, "Invoice-IA8NO7NL-0095.pdf");

    expect(parsed.invoice.invoice_date).toBe("2026-08-31");
    expect(parsed.status).toBe("extracted");
  });

  it("keeps dash-suffixed invoice numbers when PDF text has whitespace around the dash", () => {
    const parsed = parseInvoiceText(
      baseOpenAiInvoiceText.replace("IA8NO7NL-0095", "IA8NO7NL - 0095"),
      "Invoice-IA8NO7NL-0095.pdf",
    );

    expect(parsed.invoice.invoice_number).toBe("IA8NO7NL-0095");
  });

  it("normalizes OpenAI PDF null separators as invoice number dashes", () => {
    const parsed = parseInvoiceText(
      baseOpenAiInvoiceText.replace("Invoice number IA8NO7NL-0095", "Invoice numberIA8NO7NL\u00000095"),
      "Invoice-IA8NO7NL-0095.pdf",
    );

    expect(parsed.invoice.invoice_number).toBe("IA8NO7NL-0095");
    expect(parsed.invoice.invoice_date).toBe("2026-08-31");
    expect(parsed.status).toBe("extracted");
  });

  it("extracts distinct invoice numbers from the real OpenAI August PDF text shape", () => {
    const parsedInvoices = ["0095", "0094", "0093"].map((suffix) =>
      parseInvoiceText(
        baseOpenAiInvoiceText.replace("Invoice number IA8NO7NL-0095", `Invoice numberIA8NO7NL\u0000${suffix}`),
        `Invoice-IA8NO7NL-${suffix}.pdf`,
      ),
    );

    expect(parsedInvoices.map((item) => item.invoice.invoice_number)).toEqual([
      "IA8NO7NL-0095",
      "IA8NO7NL-0094",
      "IA8NO7NL-0093",
    ]);
  });

  it("marks the invoice as Da verificare when the invoice number cannot be extracted", () => {
    const parsed = parseInvoiceText(
      `
OpenAI, L.L.C.
VAT ID IE4143435AH
Date of issue August 31, 2026
Subtotal EUR 13.21
Tax EUR 0.00
Total EUR 13.21
`,
      "openai-missing-number.pdf",
    );

    expect(parsed.status).toBe("needs_review");
    expect(parsed.warnings).toContain("Numero fattura mancante o incerto.");
  });

  it("marks the invoice as Da verificare when the invoice date cannot be extracted", () => {
    const parsed = parseInvoiceText(
      baseOpenAiInvoiceText.replace("Date of issue August 31, 2026", "Date of issue August 32, 2026"),
      "openai-invalid-date.pdf",
    );

    expect(parsed.status).toBe("needs_review");
    expect(parsed.warnings).toContain("Data fattura mancante o incerta.");
  });
});
