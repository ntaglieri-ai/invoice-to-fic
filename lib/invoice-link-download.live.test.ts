import { expect, it } from "vitest";
import { downloadOpenaiInvoice } from "./invoice-link-download";
import { parseInvoicePdf } from "./invoice-parser";

// Opt-in only: pass a private invoice link in the environment, never in source or CLI arguments.
it.skipIf(!process.env.OPENAI_TEST_URL)("downloads an OpenAI PDF in a clean browser without signing in", async () => {
  const buffer = await downloadOpenaiInvoice(process.env.OPENAI_TEST_URL!);
  const result = await parseInvoicePdf(buffer, "live-test.pdf");
  expect(result.invoice.supplier).toBe("OpenAI");
  expect(result.invoice.invoice_number).toMatch(/^[A-Z0-9]+-\d+$/);
  expect(result.invoice.total_amount).toBeGreaterThan(0);
}, 100000);
