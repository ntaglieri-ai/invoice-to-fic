import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const GOOGLE_COOKIE = "invoice_google";
export const GOOGLE_STATE = "invoice_google_state";
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.file"];
export type GoogleSession = { access: string; refresh: string; expires: number; scope: string };

export function googleConfig() {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "APP_SESSION_SECRET"].filter((key) => !process.env[key]?.trim());
  return { configured: missing.length === 0, missing };
}

function key() {
  if (!process.env.APP_SESSION_SECRET) throw new Error("Configurazione sessione mancante.");
  return createHash("sha256").update(`google-v1:${process.env.APP_SESSION_SECRET}`).digest();
}

export function sealGoogle(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openGoogle<T>(value?: string): T | null {
  if (!value) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  } catch { return null; }
}

export async function googleToken(fields: Record<string, string>, previous?: GoogleSession): Promise<GoogleSession> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ ...fields, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }),
  });
  if (!response.ok) throw new Error("Autorizzazione Google scaduta o non valida. Ricollega Google.");
  const data = await response.json();
  const scope = data.scope ?? previous?.scope ?? "";
  if (!GOOGLE_SCOPES.every((item) => scope.split(" ").includes(item))) throw new Error("Autorizza sia Gmail sia Drive e riprova.");
  const refresh = data.refresh_token ?? previous?.refresh;
  if (!data.access_token || !refresh || !Number.isFinite(data.expires_in)) throw new Error("Autorizzazione Google incompleta. Ricollega Google.");
  return { access: data.access_token, refresh, expires: Date.now() + data.expires_in * 1000, scope };
}

export async function freshGoogle(session: GoogleSession) {
  return session.expires > Date.now() + 120000 ? session : googleToken({ grant_type: "refresh_token", refresh_token: session.refresh }, session);
}

export function googleCookieOptions(request: Request) {
  return { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
}

export class GoogleApiError extends Error {
  constructor(message: string, public stopBatch: boolean) { super(message); }
}

export async function googleFetch(session: GoogleSession, path: string, init: RequestInit = {}) {
  if (!/^\/(gmail\/v1\/|drive\/v3\/|upload\/drive\/v3\/)/.test(path)) throw new Error("Endpoint Google non valido.");
  const service = path.startsWith("/gmail/") ? "Gmail" : "Drive";
  const method = (init.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://www.googleapis.com${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(25000), headers: { ...init.headers, Authorization: `Bearer ${session.access}` } });
    if (response.ok) return response;
    const body = await response.json().catch(() => ({}));
    const reasons: string[] = Array.isArray(body.error?.errors) ? body.error.errors.map((e: { reason?: string }) => e.reason ?? "") : [];
    const rateLimited = response.status === 429 || reasons.some((r) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(r));
    const temporary = rateLimited || response.status >= 500;
    // Retry reads only. An uncertain file creation must be checked on Drive before another write.
    if (method === "GET" && temporary && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt + Math.floor(Math.random() * 250)));
      continue;
    }
    let detail = "Richiesta rifiutata. Verifica la connessione e riprova.";
    let code = "unknown";
    if (reasons.includes("storageQuotaExceeded")) { code = "storageQuotaExceeded"; detail = "Spazio Google Drive esaurito. Libera spazio prima di riprovare."; }
    else if (rateLimited) { code = "rateLimitExceeded"; detail = "Limite temporaneo di richieste Google raggiunto. Attendi qualche minuto e riprova."; }
    else if (reasons.includes("dailyLimitExceeded")) { code = "dailyLimitExceeded"; detail = "Quota giornaliera Google esaurita. Verifica le quote del progetto Google Cloud."; }
    else if (reasons.includes("accessNotConfigured")) { code = "accessNotConfigured"; detail = `Abilita l'API ${service} nel progetto Google Cloud.`; }
    else if (response.status === 401 || reasons.includes("authError")) { code = "authError"; detail = "Autorizzazione Google scaduta. Ricollega Google."; }
    else if (reasons.some((r) => ["insufficientPermissions", "forbidden", "insufficientFilePermissions"].includes(r)) || response.status === 403) { code = "permissionDenied"; detail = `Accesso ${service} negato. Ricollega Google autorizzando Gmail e Drive; verifica anche i permessi del file.`; }
    else if (response.status === 404) { code = "notFound"; detail = "File o mail non piu disponibile. Ripeti la ricerca."; }
    else if (temporary) { code = "unavailable"; detail = "Servizio Google temporaneamente non disponibile. Ripeti la ricerca prima di riprovare l'importazione."; }
    console.warn("[google-api] request failed", { service, method, status: response.status, code });
    throw new GoogleApiError(`${service} (${response.status}): ${detail}`, response.status !== 404);
  }
}
