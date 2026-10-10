import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany } from "@/lib/fic-expenses";
import { loadFicMonth } from "@/lib/fic-month";

export const maxDuration = 120;
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
    if (raw.length > 2000) throw new Error("Richiesta non valida.");
    const body = JSON.parse(raw);
    if (!Number.isSafeInteger(body.companyId) || body.companyId <= 0 || typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) throw new Error("Mese o azienda non validi.");
    session = shouldRefreshSession(stored) ? await refreshFattureInCloudSession(stored) : stored;
    await requireCompany(session.accessToken, body.companyId);
    const invoices = await loadFicMonth(session.accessToken, body.companyId, body.month);
    return reply({ invoices });
  } catch {
    return reply({ error: "Recupero del mese da FIC non riuscito. Nessun dato modificato: riprova o verifica la connessione." }, 400);
  }
}
