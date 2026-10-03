import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { FIC_API_BASE_URL, FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany, listExpenseSuppliers, findExistingExpense } from "@/lib/fic-expenses";
import { findExistingTd17 } from "@/lib/fic-td17";
import { normalizeIdentifier } from "@/lib/expense-validation";
import type { InvoiceFields } from "@/lib/types";

export const maxDuration = 60;
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  const jar = await cookies();
  if (!await verifyAppSessionCookieValue(jar.get(APP_AUTH_COOKIE)?.value)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const stored = unsealFattureInCloudSession(jar.get(FIC_SESSION_COOKIE)?.value ?? "");
  if (!stored) return NextResponse.json({ error: "Collega FIC." }, { status: 401 });
  let session = stored;
  const reply = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (session !== stored) response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), maxAge: 60 * 60 * 24 * 30, path: "/" });
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 16000) throw new Error("Richiesta troppo grande.");
    const body = JSON.parse(raw);
    if (!Number.isSafeInteger(body.companyId) || body.companyId <= 0 || !Array.isArray(body.records) || body.records.length > 5) throw new Error("Riferimenti non validi.");
    session = shouldRefreshSession(stored) ? await refreshFattureInCloudSession(stored) : stored;
    await requireCompany(session.accessToken, body.companyId);
    const suppliers = body.records.some((record: { expenseId?: number; td17Id?: number }) => !record.expenseId || !record.td17Id) ? await listExpenseSuppliers(session.accessToken, body.companyId) : [];
    const records = await Promise.all(body.records.map(async (record: { key: string; expenseId?: number; td17Id?: number; invoice: InvoiceFields }) => {
      if (typeof record.key !== "string" || record.key.length > 500) throw new Error("Riferimento non valido.");
      let recoveredExpenseId: number | undefined;
      let recoveredTd17Id: number | undefined;
      if (!record.expenseId || !record.td17Id) {
        const invoice = record.invoice;
        if (!invoice || typeof invoice.invoice_number !== "string" || invoice.invoice_number.length > 200 || typeof invoice.invoice_date !== "string" || typeof invoice.supplier_vat !== "string") throw new Error("Fattura non valida.");
        const matches = invoice.supplier_vat ? suppliers.filter((supplier) => normalizeIdentifier(supplier.vat_number ?? "") === normalizeIdentifier(invoice.supplier_vat)) : [];
        if (matches.length > 1) throw new Error("Piu fornitori con lo stesso VAT in FIC. Verifica l'anagrafica.");
        if (matches[0]) {
          const supplier = { ...matches[0], vat_number: matches[0].vat_number! };
          const [expense, td17] = await Promise.all([!record.expenseId ? findExistingExpense(session.accessToken, body.companyId, invoice, supplier) : undefined, !record.td17Id ? findExistingTd17(session.accessToken, body.companyId, invoice, supplier) : undefined]);
          recoveredExpenseId = expense?.id; recoveredTd17Id = td17?.id;
        }
      }
      async function exists(id: number | undefined, type: string) {
        if (id === undefined) return undefined;
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID non valido.");
        const response = await fetch(`${FIC_API_BASE_URL}/c/${body.companyId}/${type}/${id}?fields=id`, { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(`Verifica FIC non riuscita (${response.status}). Stati conservati.`);
        const data = await response.json();
        if (data?.data?.id !== id) throw new Error("Risposta FIC incompleta. Stati conservati.");
        return true;
      }
      const [expenseExists, td17Exists] = await Promise.all([exists(record.expenseId, "received_documents"), exists(record.td17Id, "issued_documents")]);
      return { key: record.key, expenseExists, td17Exists, expenseId: recoveredExpenseId, td17Id: recoveredTd17Id };
    }));
    return reply({ records });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Verifica non riuscita.";
    return reply({ error: /https?:|token|Bearer/i.test(message) ? "Verifica FIC non riuscita. Stati conservati." : message }, 400);
  }
}
