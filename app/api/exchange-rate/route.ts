import { NextResponse } from "next/server";
import { ecbExchangeRate } from "@/lib/ecb-exchange-rate";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  try { return NextResponse.json(await ecbExchangeRate(query.get("currency") ?? "", query.get("date") ?? ""), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Cambio non disponibile." }, { status: 400 }); }
}
