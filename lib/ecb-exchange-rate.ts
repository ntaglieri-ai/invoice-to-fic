import { load } from "cheerio";

export function parseEcbRate(xml: string, currency: string, requestedDate: string) {
  const $ = load(xml, { xmlMode: true });
  const candidates = $("Cube[time]").toArray().filter((element) => ($(element).attr("time") ?? "") <= requestedDate).sort((a, b) => ($(b).attr("time") ?? "").localeCompare($(a).attr("time") ?? ""));
  for (const element of candidates) {
    const date = $(element).attr("time")!;
    if (Date.parse(requestedDate) - Date.parse(date) > 7 * 86400000) break;
    const perEuro = Number($(element).find(`Cube[currency="${currency}"]`).attr("rate"));
    if (Number.isFinite(perEuro) && perEuro > 0) return { currency, date, rate: Number((1 / perEuro).toFixed(12)), source: "ECB" as const };
  }
  throw new Error("Cambio BCE non disponibile per questa data. Scegli una data corretta o inserisci un cambio manuale da confermare.");
}

export async function ecbExchangeRate(currency: string, date: string) {
  if (!/^[A-Z]{3}$/.test(currency) || currency === "EUR" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Valuta o data cambio non valida.");
  const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml", { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Servizio cambi BCE non disponibile. Puoi indicare un cambio manuale.");
  const xml = await response.text();
  if (xml.length > 10000000) throw new Error("Risposta BCE non valida.");
  return parseEcbRate(xml, currency, date);
}
