import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { freshGoogle, GOOGLE_COOKIE, googleCookieOptions, googleFetch, openGoogle, sealGoogle, type GoogleSession } from "@/lib/google-session";
import { FIC_SESSION_COOKIE, refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany } from "@/lib/fic-expenses";
import { loadInvoiceMemory, saveInvoiceMemory, MemoryConflict } from "@/lib/drive-invoice-memory";
import { cleanMemoryEvent } from "@/lib/invoice-memory";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Richiesta non consentita." }, { status: 403 });
  const jar = await cookies();
  if (!await verifyAppSessionCookieValue(jar.get(APP_AUTH_COOKIE)?.value)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  const storedGoogle = openGoogle<GoogleSession>(jar.get(GOOGLE_COOKIE)?.value);
  const storedFic = unsealFattureInCloudSession(jar.get(FIC_SESSION_COOKIE)?.value ?? "");
  if (!storedGoogle || !storedFic) return NextResponse.json({ error: "Collega Google e FIC per recuperare la memoria delle fatture." }, { status: 401 });
  let google = storedGoogle;
  let fic = storedFic;
  const reply = (data: unknown, status = 200) => {
    const response = NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
    if (google !== storedGoogle) response.cookies.set(GOOGLE_COOKIE, sealGoogle(google), googleCookieOptions(request));
    if (fic !== storedFic) response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(fic), { httpOnly: true, sameSite: "lax", secure: request.url.startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  };
  try {
    const raw = await request.text();
    if (raw.length > 250000) return reply({ error: "Aggiornamento troppo grande." }, 413);
    const body = JSON.parse(raw);
    if (!Number.isSafeInteger(body.companyId) || body.companyId <= 0 || !["load", "save"].includes(body.action)) return reply({ error: "Richiesta non valida." }, 400);
    const event = body.action === "save" ? cleanMemoryEvent(body.event) : undefined;
    google = await freshGoogle(storedGoogle);
    fic = shouldRefreshSession(storedFic) ? await refreshFattureInCloudSession(storedFic) : storedFic;
    await requireCompany(fic.accessToken, body.companyId);
    const records = event ? await saveInvoiceMemory(google, body.companyId, event) : (await loadInvoiceMemory(google, body.companyId)).records;
    // Drive permissionId identifies the connected account without exposing email or OAuth credentials.
    const about = await googleFetch(google, "/drive/v3/about?fields=user(permissionId)");
    const accountId = (await about.json()).user?.permissionId;
    if (typeof accountId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(accountId)) throw new Error("Account Google non riconosciuto.");
    return reply({ records, accountId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memoria online non disponibile.";
    return reply({ error: /https?:|token|Bearer|<html|JSON/i.test(message) ? "Memoria online non disponibile. Riprova o ricollega Google." : message }, error instanceof MemoryConflict ? 409 : 400);
  }
}
