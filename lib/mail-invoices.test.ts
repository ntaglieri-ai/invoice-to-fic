import { describe, expect, it } from "vitest";
import { allowedInvoiceUrl, classifyMail, inRomeMonth, monthQuery, openaiInvoiceLink, supplierQuery, type MailMessage } from "./mail-invoices";
import { browserHostAllowed } from "./invoice-link-download";

function mail(from = "invoice+statements@vercel.com"): MailMessage {
  return { id: "abc", internalDate: "1789603200000", payload: { headers: [{ name: "From", value: `Supplier <${from}>` }, { name: "Subject", value: "Invoice example" }], parts: [
    { partId: "1", filename: "Invoice-TEST-0091.pdf", mimeType: "application/octet-stream", body: { attachmentId: "a" } },
    { partId: "2", filename: "Receipt-123.pdf", mimeType: "application/pdf", body: { attachmentId: "b" } },
  ] } };
}
describe("Gmail invoice candidates", () => {
  it("builds supplier queries exclusively from trusted senders", () => {
    expect(supplierQuery()).toBe("");
    expect(supplierQuery("OpenAI")).toBe("{from:noreply@tm.openai.com}");
    expect(supplierQuery("Anthropic")).toContain("from:invoice+statements@mail.anthropic.com");
    for (const value of [null, 1, {}, "Unknown", "OpenAI OR label:Inbox"]) expect(() => supplierQuery(value)).toThrow("Fornitore non valido");
  });
  it.each([["invoice+statements@vercel.com", "Vercel"], ["invoice+statements@mail.anthropic.com", "Anthropic"], ["invoice+statements@supabase.com", "Supabase"], ["billing@hetzner.com", "Hetzner"]])("recognizes %s and excludes receipt", (from, supplier) => {
    expect(classifyMail(mail(from))).toMatchObject({ supplier, invoices: [{ partId: "1" }], receipts: 1 });
  });
  it("does not trust display names or lookalike sender domains", () => {
    const m = mail("billing@hetzner.com.attacker.example");
    expect(classifyMail(m)).toMatchObject({ supplier: "Sconosciuto", invoices: [] });
  });
  it("finds nested attachments", () => {
    const m = mail(); m.payload.parts = [{ parts: m.payload.parts }];
    expect(classifyMail(m).invoices).toHaveLength(1);
  });
  it("selects only the invoice link and decodes HTML attributes", () => {
    const m = mail("noreply@tm.openai.com");
    m.payload.parts = [{ mimeType: "text/html", body: { data: Buffer.from('<a href="https://example.com">Billing history</a><a href="https://mandrillapp.com/track?p=test&amp;x=1">Visualizza la fattura</a>').toString("base64url") } }];
    expect(openaiInvoiceLink(m)).toBe("https://mandrillapp.com/track?p=test&x=1");
    expect(classifyMail(m)).toMatchObject({ linkAvailable: true, supplier: "OpenAI" });
  });
  it.each(["http://invoice.stripe.com/x", "https://invoice.stripe.com.evil.test/x", "https://localhost/x", "https://127.0.0.1/x", "file:///etc/passwd", "https://a:secret@invoice.stripe.com/x", "https://invoice.stripe.com:8000/x"])("blocks untrusted link %s", (url) => {
    expect(allowedInvoiceUrl(url)).toBe(false); expect(browserHostAllowed(url)).toBe(false);
  });
  it("restricts browser requests and permits Stripe resources", () => {
    expect(browserHostAllowed("https://js.stripe.com/v3")).toBe(true);
    expect(browserHostAllowed("https://b.stripecdn.com/assets.js")).toBe(true);
    expect(browserHostAllowed("https://stripe-upload-api.s3.us-west-1.amazonaws.com/invoice.pdf")).toBe(true);
    expect(browserHostAllowed("https://other-bucket.s3.us-west-1.amazonaws.com/invoice.pdf")).toBe(false);
    expect(browserHostAllowed("https://hcaptcha.com/challenge")).toBe(false);
    expect(browserHostAllowed("https://example.com")).toBe(false);
  });
  it("validates months and applies Rome month boundaries", () => {
    expect(() => monthQuery("2026-13")).toThrow();
    expect(() => monthQuery("2026-09 OR label:Inbox")).toThrow();
    const m = mail(); m.internalDate = String(Date.parse("2026-08-31T22:30:00Z"));
    expect(inRomeMonth(m, "2026-09")).toBe(true);
    expect(inRomeMonth(m, "2026-08")).toBe(false);
  });
});
