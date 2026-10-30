import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { ticketOwner } from "@/lib/fic-expenses";
import { canWriteExpenses } from "@/lib/fic-permissions";
import { previewExpenseReversals, readReversalTicket, reverseExpensePayments } from "@/lib/fic-expense-payments";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  const jar = await cookies(), auth = jar.get(APP_AUTH_COOKIE)?.value;
  if (!auth || !await verifyAppSessionCookieValue(auth)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const stored = unsealFattureInCloudSession(jar.get(FIC_SESSION_COOKIE)?.value ?? "");
  if (!stored) return NextResponse.json({ error: "Collega FIC." }, { status: 401 });
  let session = stored;
  const reply = (data: unknown, status = 200) => {
    const response = NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
    if (session !== stored) response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https:"), path: "/", maxAge: 2592000 });
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 65000) return reply({ error: "Richiesta troppo grande." }, 413);
    const body = JSON.parse(raw);
    session = shouldRefreshSession(stored) ? await refreshFattureInCloudSession(stored) : stored;
    if (!canWriteExpenses(session.scope)) return reply({ error: "Autorizza la gestione spese in FIC." }, 403);
    if (body?.action === "preview" && body.month === "2026-09") return reply(await previewExpenseReversals(session.accessToken, body.companyId, body.expenseIds, ticketOwner(auth)));
    if (body?.action !== "reverse" || body.confirmed !== true || !Number.isSafeInteger(body.id) || body.id <= 0) return reply({ error: "Anteprima e conferma esplicita richieste." }, 400);
    return reply(await reverseExpensePayments(session.accessToken, readReversalTicket(body.ticket, ticketOwner(auth)), body.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Operazione non riuscita.";
    return reply({ error: /https?:|Bearer|token|<html/i.test(message) ? "Operazione FIC non riuscita. Controlla lo stato prima di riprovare." : message }, 400);
  }
}
