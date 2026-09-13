import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildFattureInCloudAuthorizationUrl,
  FIC_STATE_COOKIE,
  getFattureInCloudConfigStatus,
} from "@/lib/fatture-in-cloud";

export async function GET(request: Request) {
  const status = getFattureInCloudConfigStatus();

  if (!status.configured) {
    const url = new URL("/", request.url);
    url.searchParams.set("fic", "missing-config");
    return NextResponse.redirect(url);
  }

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(buildFattureInCloudAuthorizationUrl(state));
  response.cookies.set(FIC_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    maxAge: 10 * 60,
    path: "/",
  });

  return response;
}
