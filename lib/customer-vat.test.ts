import { describe, expect, it } from "vitest";
import { customerVatIssue, extractCustomerVat, requireCustomerVat } from "./customer-vat";
import { parseInvoiceText } from "./invoice-parser";
import { EMPTY_INVOICE } from "./suppliers/common";

const invoice = { ...EMPTY_INVOICE, supplier: "Anthropic" as const, customer_vat: "IT12345678901" };
const sample = (billing: string) => `Anthropic PBC
Invoice number TEST-0001
Invoice date September 12, 2026
IE VAT IE4276970QH
Bill to
Example customer
Italy
${billing}
Description
Services
Subtotal EUR 20.00
Tax EUR 0.00
Total EUR 20.00`;

describe("customer VAT, separate from supplier VAT", () => {
  it("reads the compact Stripe billing VAT", () => {
    expect(extractCustomerVat(sample("IT VATIT12345678901"))).toBe("IT12345678901");
  });
  it("does not use supplier VAT, shipping VAT or email address", () => {
    expect(extractCustomerVat(sample("name@example.com\nShip to\nIT VAT IT12345678901"))).toBe("");
    expect(extractCustomerVat("IE VAT IE4276970QH")).toBe("");
  });
  it("fails closed on conflicting or malformed billing VAT", () => {
    expect(extractCustomerVat(sample("IT VAT IT12345678901\nVAT IT99999999999"))).toBe("");
    expect(extractCustomerVat(sample("VAT IT123456789012"))).toBe("");
  });
  it("marks missing customer VAT for review without calling it personal", () => {
    const result = parseInvoiceText(sample("name@example.com"));
    expect(result.invoice.customer_vat).toBe("");
    expect(result.status).toBe("needs_review");
    expect(result.warnings.join(" ")).toContain("Partita IVA cliente");
    expect(result.invoice.supplier_vat).toBe("IE4276970QH");
  });
  it("preserves an extracted customer VAT", () => {
    expect(parseInvoiceText(sample("IT VATIT12345678901")).invoice.customer_vat).toBe("IT12345678901");
  });
  it("handles the actual Stripe registration label and null separator", () => {
    const text = sample("IT VATIT12345678901")
      .replace("IE VAT IE4276970QH", "VAT RegistrationEU VAT\u0000 IE4276970QH")
      .replace("TEST-0001", "TEST\u00000001")
      .replace("Invoice date", "Date of issue");
    expect(parseInvoiceText(text).invoice).toMatchObject({ supplier_vat: "IE4276970QH", customer_vat: "IT12345678901", invoice_number: "TEST-0001", invoice_date: "2026-09-12" });
  });
  it("normalizes the Italian country prefix and whitespace", () => {
    expect(customerVatIssue(invoice, "12345678901")).toBeNull();
    expect(customerVatIssue(invoice, " it 12345678901 ")).toBeNull();
  });
  it("blocks missing, different and unavailable VAT", () => {
    expect(() => requireCustomerVat({ ...invoice, customer_vat: undefined }, "12345678901")).toThrow("cliente assente");
    expect(() => requireCustomerVat(invoice, "99999999999")).toThrow("diversa");
    expect(() => requireCustomerVat(invoice, null)).toThrow("azienda non disponibile");
    expect(() => requireCustomerVat({ ...invoice, customer_vat: "IE12345678901" }, "12345678901")).toThrow();
  });
  it("leaves other supplier workflows unchanged", () => {
    expect(customerVatIssue({ ...invoice, supplier: "OpenAI" }, null)).toBeNull();
  });
});
