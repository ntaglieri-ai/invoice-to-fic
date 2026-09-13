import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  FIC_SESSION_COOKIE,
  getFattureInCloudConfigStatus,
  listUserCompanies,
  refreshFattureInCloudSession,
  sealFattureInCloudSession,
  shouldRefreshSession,
  unsealFattureInCloudSession,
} from "@/lib/fatture-in-cloud";

export async function GET(request: Request) {
  const config = getFattureInCloudConfigStatus();
  const cookieStore = await cookies();
  const sealedSession = cookieStore.get(FIC_SESSION_COOKIE)?.value;

  if (!sealedSession) {
    return NextResponse.json({
      connected: false,
      config,
      companies: [],
    });
  }

  const parsedSession = unsealFattureInCloudSession(sealedSession);
  if (!parsedSession) {
    const response = NextResponse.json({
      connected: false,
      config,
      companies: [],
      error: "Sessione Fatture in Cloud non valida.",
    });
    response.cookies.delete(FIC_SESSION_COOKIE);
    return response;
  }

  if (!config.configured) {
    return NextResponse.json({
      connected: false,
      config,
      companies: [],
      error: "Configurazione Fatture in Cloud incompleta.",
    });
  }

  try {
    const session = shouldRefreshSession(parsedSession)
      ? await refreshFattureInCloudSession(parsedSession)
      : parsedSession;
    const companies = await listUserCompanies(session.accessToken);
    const response = NextResponse.json({
      connected: true,
      config,
      companies,
      expiresAt: session.expiresAt,
      scope: session.scope,
    });

    if (session !== parsedSession) {
      response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), {
        httpOnly: true,
        sameSite: "lax",
        secure: request.url.startsWith("https://"),
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connessione Fatture in Cloud non riuscita.";
    const response = NextResponse.json({
      connected: false,
      config,
      companies: [],
      error: message,
    });
    response.cookies.delete(FIC_SESSION_COOKIE);
    return response;
  }
}
