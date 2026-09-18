import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import { allowedInvoiceUrl } from "@/lib/mail-invoices";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export function browserHostAllowed(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && (["mandrillapp.com", "b.stripecdn.com", "stripe-upload-api.s3.us-west-1.amazonaws.com", "stripe.com"].includes(u.hostname) || u.hostname.endsWith(".stripe.com"));
  } catch { return false; }
}

async function resolveStripeInvoice(value: string) {
  let url = value;
  for (let hop = 0; hop < 5; hop++) {
    if (!allowedInvoiceUrl(url)) throw new Error("Redirect fattura non consentito.");
    if (new URL(url).hostname === "invoice.stripe.com") return url;
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error("Link fattura non valido.");
    url = new URL(location, url).toString();
  }
  throw new Error("Troppi redirect fattura.");
}

export async function downloadOpenaiInvoice(url: string): Promise<Buffer> {
  if (!allowedInvoiceUrl(url)) throw new Error("Link fattura non consentito.");
  const invoiceUrl = await resolveStripeInvoice(url);
  const browser = await playwright.launch({ args: process.env.CHROMIUM_EXECUTABLE_PATH ? undefined : chromium.args, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(), headless: true, timeout: 20000 });
  try {
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      if (browserHostAllowed(route.request().url())) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(invoiceUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 25000 });
    // Observe rejection immediately if the button is missing or the link has expired.
    void downloadPromise.catch(() => undefined);
    await page.getByRole("button", { name: /^(Scarica fattura|Download invoice)$/i }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_PDF_BYTES) { await download.cancel(); throw new Error("PDF troppo grande."); }
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Il link non ha restituito un PDF.");
    return buffer;
  } catch {
    throw new Error("Download OpenAI non riuscito: link scaduto, accesso richiesto o pagina non disponibile. Apri la mail e carica il PDF manualmente.");
  } finally { await browser.close(); }
}
