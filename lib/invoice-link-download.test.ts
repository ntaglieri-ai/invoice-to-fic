import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
vi.mock("playwright-core", () => ({ chromium: { launch: vi.fn() } }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: [], executablePath: async () => "/test/chromium" } }));
import { chromium } from "playwright-core";
import { downloadOpenaiInvoice } from "./invoice-link-download";

const close = vi.fn();
const control = { waitFor: vi.fn(), click: vi.fn() };
const locator = { or: vi.fn(() => ({ first: () => control })) };
const page = { setDefaultTimeout: vi.fn(), goto: vi.fn(), getByRole: vi.fn(() => locator), waitForEvent: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  locator.or.mockReturnValue({ first: () => control });
  page.getByRole.mockReturnValue(locator);
  page.goto.mockResolvedValue({ status: () => 200 });
  page.waitForEvent.mockResolvedValue({ createReadStream: async () => Readable.from([Buffer.from("%PDF-test")]) });
  vi.mocked(chromium.launch).mockResolvedValue({ close, newContext: async () => ({ route: vi.fn(), newPage: async () => page }) } as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("supports the invoice download link as well as button and closes the browser", async () => {
  expect((await downloadOpenaiInvoice("https://invoice.stripe.com/i/private")).toString()).toBe("%PDF-test");
  expect(page.getByRole).toHaveBeenCalledWith("link", expect.anything());
  expect(control.click).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
it("reports denied access without claiming the link expired or leaking its URL", async () => {
  page.goto.mockResolvedValue({ status: () => 403 });
  await expect(downloadOpenaiInvoice("https://invoice.stripe.com/i/private")).rejects.toThrow("verifica manuale");
  expect(control.click).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private");
});
it("marks rate limiting as a reason to stop the batch", async () => {
  page.goto.mockResolvedValue({ status: () => 429 });
  await expect(downloadOpenaiInvoice("https://invoice.stripe.com/i/private")).rejects.toMatchObject({ stopBatch: true });
});
