import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { canWriteExpenses, createReviewedExpense, findExistingExpense, listExpenseSuppliers, readExpenseTicket, requireCompany, requireSupplier, signExpenseTicket, ticketOwner } from "@/lib/fic-expenses";
import { hasExpenseTaxSettings, validateExpensePreparation, type ExpensePreparationOptions } from "@/lib/expense-validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  }
  const store = await cookies();
  const auth = store.get(APP_AUTH_COOKIE)?.value;
  if (!auth || !await verifyAppSessionCookieValue(auth)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const parsed = unsealFattureInCloudSession(store.get(FIC_SESSION_COOKIE)?.value ?? "");
  if (!parsed) return NextResponse.json({ error: "Collega Fatture in Cloud." }, { status: 401 });
  let session = parsed;
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (session !== parsed) response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), {
      httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), maxAge: 60 * 60 * 24 * 30, path: "/",
    });
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 16000) return respond({ error: "Richiesta troppo grande." }, 413);
    const body = JSON.parse(raw);
    session = shouldRefreshSession(parsed) ? await refreshFattureInCloudSession(parsed) : parsed;
    if (!canWriteExpenses(session.scope)) return respond({ error: "Ricollega FIC per autorizzare la creazione delle spese." }, 403);
    const token = session.accessToken;
    if (body.action === "create") {
      if (body.confirmed !== true) return respond({ error: "Conferma manuale richiesta." }, 400);
      const ticket = readExpenseTicket(body.ticket, ticketOwner(auth));
      return respond(await createReviewedExpense(token, ticket));
    }
    const company = await requireCompany(token, body.companyId);
    if (body.action === "suppliers") return respond({ suppliers: await listExpenseSuppliers(token, body.companyId) });
    if (body.action !== "preview" || body.approved !== true) return respond({ error: "Approva la fattura prima dell'anteprima." }, 400);
    validateExpensePreparation(body.invoice, body.options);
    const invoice = body.invoice;
    const options = body.options as ExpensePreparationOptions;
    const supplier = await requireSupplier(token, body.companyId, invoice, options);
    const duplicate = await findExistingExpense(token, body.companyId, invoice, supplier);
    if (duplicate) return respond({ error: `Spesa gia presente in FIC (ID ${duplicate.id}).`, existingId: duplicate.id }, 409);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    if (!hasExpenseTaxSettings(options)) {
      return respond({ ticket: null, status: "needs_configuration", companyName: company.name, supplier, invoice, options, expiresAt });
    }
    const ticket = signExpenseTicket({ companyId: body.companyId, invoice, options, expiresAt, owner: ticketOwner(auth) });
    return respond({ ticket, status: "ready", companyName: company.name, supplier, invoice, options, expiresAt });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Operazione FIC non riuscita." }, 400);
  }
}
