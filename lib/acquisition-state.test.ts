import { expect, it } from "vitest";
import { acquisitionDownloadState, acquisitionInRegister, mailAcquisitionEntries } from "./acquisition-state";
import type { WorkflowInvoice } from "./invoice-workflow";
import type { MailCandidate } from "./mail-invoices";
const mail: MailCandidate = { id: "mail1", subject: "Crediti ricaricati", supplier: "OpenAI", date: "2026-09-18", invoiceNumber: "IA8NO7NL-0189", invoices: [], receipts: 0, linkAvailable: true, archives: {} };
it("recognizes an acquired PDF by full invoice identity without treating FIC-only records as downloads", () => {
  const [entry] = mailAcquisitionEntries(mail);
  const invoice: WorkflowInvoice = { id: "manual-1", index: 0, file_name: "Invoice-IA8NO7NL-0189.pdf", status: "extracted", confidence: 1, extracted_text_preview: "", warnings: [], invoice: { supplier: "OpenAI", invoice_number: "IA8NO7NL-0189", invoice_date: "2026-09-17", currency: "EUR", net_amount: 13, tax_amount: 0, total_amount: 13, supplier_vat: "IE4143435AH" } };
  expect(acquisitionInRegister(entry, [invoice], [])).toBe(true);
  expect(acquisitionInRegister(entry, [{ ...invoice, id: "fic-1" }], [])).toBe(false);
  expect(acquisitionInRegister(entry, [{ ...invoice, invoice: { ...invoice.invoice, supplier: "Anthropic" } }], [])).toBe(false);
});
it("shows an identifiable OpenAI PDF and labels the receipt date before download", () => {
  const [entry] = mailAcquisitionEntries(mail);
  expect(entry.name).toBe("OpenAI · Invoice-IA8NO7NL-0189.pdf");
  expect(entry.dateKind).toBe("mail");
  expect(acquisitionDownloadState(entry, [], [])).toBe("not_downloaded");
});
it("marks archived PDFs downloaded even when they are not in the processing register", () => {
  const [entry] = mailAcquisitionEntries({ ...mail, archives: { "openai-link": { driveId: "pdf1", name: "Invoice-IA8NO7NL-0189.pdf", invoiceDate: "2026-09-17" } } });
  expect(acquisitionDownloadState(entry, [], [])).toBe("downloaded");
  expect(entry.date).toBe("2026-09-17"); expect(entry.dateKind).toBe("invoice");
});
it("updates successful downloads and never interprets an unavailable Drive check as not downloaded", () => {
  const [entry] = mailAcquisitionEntries({ ...mail, archives: undefined });
  expect(acquisitionDownloadState(entry, [], [])).toBe("unknown");
  expect(acquisitionDownloadState(entry, [entry.key], [])).toBe("downloaded");
  expect(acquisitionDownloadState(entry, [], [mail.id])).toBe("manual");
});
