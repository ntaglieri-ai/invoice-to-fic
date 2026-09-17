import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { listExpenseSuppliers, requireCompany, ticketOwner } from "@/lib/fic-expenses";
import { canPrepareTd17 } from "@/lib/fic-permissions";
import { createTd17, previewTd17, readTd17Ticket, td17Settings } from "@/lib/fic-td17";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  const store = await cookies();
  const auth = store.get(APP_AUTH_COOKIE)?.value;
  if (!auth || !await verifyAppSessionCookieValue(auth)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const parsed = unsealFattureInCloudSession(store.get(FIC_SESSION_COOKIE)?.value ?? "");
  if (!parsed) return NextResponse.json({ error: "Collega Fatture in Cloud." }, { status: 401 });
  let session = parsed;
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (session !== parsed) response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), maxAge: 2592000, path: "/" });
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 16000) return respond({ error: "Richiesta troppo grande." }, 413);
    const body = JSON.parse(raw);
    session = shouldRefreshSession(parsed) ? await refreshFattureInCloudSession(parsed) : parsed;
    if (!canPrepareTd17(session.scope)) return respond({ error: "Premi Autorizza TD17 per abilitare la preparazione delle autofatture." }, 403);
    const token = session.accessToken;
    if (body.action === "create") {
      if (body.confirmed !== true) return respond({ error: "Conferma manuale richiesta per salvare il TD17 non inviato." }, 400);
      return respond(await createTd17(token, readTd17Ticket(body.ticket, ticketOwner(auth))));
    }
    await requireCompany(token, body.companyId);
    if (body.action === "settings") return respond({ suppliers: await listExpenseSuppliers(token, body.companyId), ...await td17Settings(token, body.companyId) });
    if (body.action !== "preview" || body.approved !== true) return respond({ error: "Approva la fattura prima di preparare il TD17." }, 400);
    return respond(await previewTd17(token, body.companyId, body.invoice, body.options, ticketOwner(auth)));
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Operazione TD17 non riuscita." }, 400);
  }
}
