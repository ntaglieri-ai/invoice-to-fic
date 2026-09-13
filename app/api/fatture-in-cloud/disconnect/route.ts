import { NextResponse } from "next/server";
import { FIC_SESSION_COOKIE, FIC_STATE_COOKIE } from "@/lib/fatture-in-cloud";

export async function POST() {
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(FIC_SESSION_COOKIE);
  response.cookies.delete(FIC_STATE_COOKIE);
  return response;
}
