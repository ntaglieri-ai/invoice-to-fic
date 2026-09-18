import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { freshGoogle, GOOGLE_COOKIE, GOOGLE_STATE, googleConfig, googleCookieOptions, openGoogle, sealGoogle, type GoogleSession } from "@/lib/google-session";
import { importGoogleInvoice, scanGoogleInvoices } from "@/lib/google-invoices";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const jar = await cookies();
  if (!await verifyAppSessionCookieValue(jar.get(APP_AUTH_COOKIE)?.value)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const session = openGoogle<GoogleSession>(jar.get(GOOGLE_COOKIE)?.value);
  return NextResponse.json({ config: googleConfig(), connected: Boolean(session?.refresh) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const jar = await cookies();
  if (!await verifyAppSessionCookieValue(jar.get(APP_AUTH_COOKIE)?.value)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  let session: GoogleSession | null = null;
  const reply = (data: unknown, status = 200) => {
    const response = NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
    if (session) response.cookies.set(GOOGLE_COOKIE, sealGoogle(session), googleCookieOptions(request));
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Richiesta troppo grande." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "disconnect") {
      const response = reply({ connected: false });
      response.cookies.delete(GOOGLE_COOKIE); response.cookies.delete(GOOGLE_STATE);
      return response;
    }
    const stored = openGoogle<GoogleSession>(jar.get(GOOGLE_COOKIE)?.value);
    if (!stored) return reply({ error: "Collega Google prima di importare." }, 401);
    session = await freshGoogle(stored);
    if (body.action === "scan" && typeof body.month === "string" && (body.pageToken === undefined || typeof body.pageToken === "string")) return reply(await scanGoogleInvoices(session, body.month, body.pageToken));
    if (body.action === "import" && typeof body.messageId === "string" && typeof body.partId === "string") return reply(await importGoogleInvoice(session, body.messageId, body.partId));
    return reply({ error: "Azione non valida." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Importazione non riuscita.";
    // Only expose controlled application messages, never browser/HTTP error URLs.
    return reply({ error: /https?:|token|Bearer|<html/i.test(message) ? "Importazione non riuscita. Riprova o ricollega Google." : message }, 400);
  }
}
