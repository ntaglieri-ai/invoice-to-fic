import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { GOOGLE_COOKIE, GOOGLE_STATE, googleCookieOptions, googleToken, openGoogle, sealGoogle } from "@/lib/google-session";

export async function GET(request: Request) {
  const jar = await cookies();
  const auth = jar.get(APP_AUTH_COOKIE)?.value;
  const flow = openGoogle<{ state: string; verifier: string; owner: string; expires: number }>(jar.get(GOOGLE_STATE)?.value);
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/?google=authorization-error", request.url));
  response.cookies.delete(GOOGLE_STATE);
  if (!auth || !await verifyAppSessionCookieValue(auth) || !flow || flow.expires < Date.now() || flow.state !== url.searchParams.get("state") || flow.owner !== createHash("sha256").update(auth).digest("hex") || !url.searchParams.get("code") || url.searchParams.has("error")) return response;
  try {
    const session = await googleToken({ grant_type: "authorization_code", code: url.searchParams.get("code")!, redirect_uri: process.env.GOOGLE_REDIRECT_URI!, code_verifier: flow.verifier });
    response.cookies.set(GOOGLE_COOKIE, sealGoogle(session), googleCookieOptions(request));
    response.headers.set("Location", new URL("/?google=connected", request.url).toString());
  } catch { /* Do not log authorization codes, provider responses or refresh tokens. */ }
  return response;
}
