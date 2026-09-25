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
  let browser: Awaited<ReturnType<typeof playwright.launch>> | undefined;
  let stage = "redirect";
  let httpStatus: number | undefined;
  try {
    const invoiceUrl = await resolveStripeInvoice(url);
    stage = "browser";
    browser = await playwright.launch({ args: process.env.CHROMIUM_EXECUTABLE_PATH ? undefined : chromium.args, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(), headless: true, timeout: 20000 });
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
    await context.route("**/*", (route) => {
      if (browserHostAllowed(route.request().url())) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    stage = "page";
    const response = await page.goto(invoiceUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    httpStatus = response?.status();
    if (httpStatus && httpStatus >= 400) throw new Error("Invoice page rejected");
    stage = "button";
    // Some hosted invoices expose a link instead of a button. Keep the invoice-specific label.
    const button = page.getByRole("button", { name: /^(Scarica fattura|Download invoice)$/i });
    const link = page.getByRole("link", { name: /^(Scarica fattura|Download invoice)$/i });
    const control = button.or(link).first();
    await control.waitFor({ state: "visible", timeout: 20000 });
    stage = "download";
    const downloadPromise = page.waitForEvent("download", { timeout: 25000 });
    // Observe rejection immediately if the button is missing or the link has expired.
    void downloadPromise.catch(() => undefined);
    await control.click();
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
    // Do not log private invoice URLs, browser errors, page content or signed download tokens.
    console.warn("[openai-download] failed", { stage, httpStatus });
    const detail = stage === "redirect" ? "Il link nella mail non ha aperto la pagina della fattura."
      : stage === "browser" ? "Il servizio di download non si e avviato. Riprova tra poco."
      : httpStatus === 429 ? "Il portale ha limitato le richieste. Attendi qualche minuto prima di riprovare."
      : httpStatus === 401 || httpStatus === 403 ? "Il portale richiede accesso o una verifica manuale."
      : httpStatus === 404 || httpStatus === 410 ? "La pagina della fattura non e piu disponibile."
      : stage === "button" ? "Il comando Scarica fattura non e disponibile: potrebbe essere richiesto l'accesso o un controllo manuale."
      : stage === "download" ? "Il portale non ha completato il download del PDF."
      : "La pagina della fattura non ha risposto correttamente.";
    throw Object.assign(new Error(`Download OpenAI non riuscito. ${detail} Apri la mail per verificare il link; puoi caricare il PDF manualmente.`), { stopBatch: stage === "browser" || httpStatus === 429 });
  } finally { await browser?.close(); }
}
