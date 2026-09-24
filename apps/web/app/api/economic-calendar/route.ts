import { NextRequest, NextResponse } from "next/server";
import { assessCryptoImpact, translateEconomicEvent } from "../../../lib/news/economic-impact";

export const dynamic = "force-dynamic";

type FinanceCalendarEvent = {
  date?: string;
  time_utc?: string;
  name?: string;
  title?: string;
  impact?: "high" | "medium" | "low";
  category?: string;
  consensus?: string | null;
  prior?: string | null;
  actual?: string | null;
  url?: string;
};

type FinanceCalendarResponse = {
  events?: FinanceCalendarEvent[];
  attribution?: { source?: string; terms?: string };
};

export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") ?? "today";
  const { start, end } = dateRange(range);
  const endpoint = new URL("https://www.financecalendar.com/wp-json/fc/v1/calendar");
  endpoint.searchParams.set("from", start);
  endpoint.searchParams.set("to", end);
  endpoint.searchParams.set("limit", "250");

  try {
    const response = await fetch(endpoint, { next: { revalidate: 300 }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Finance Calendar respondió ${response.status}`);
    const payload = await response.json() as FinanceCalendarResponse;
    const events = (payload.events ?? [])
      .filter((item) => item.date && (item.name || item.title))
      .map((item, index) => normalizeEvent(item, index))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return NextResponse.json(
      {
        state: "live",
        fetchedAt: new Date().toISOString(),
        events,
        attribution: {
          source: payload.attribution?.source ?? "financecalendar.com",
          url: "https://www.financecalendar.com",
          terms: payload.attribution?.terms ?? "Uso gratuito con atribución.",
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
    );
  } catch (error) {
    return NextResponse.json(
      { state: "unavailable", fetchedAt: new Date().toISOString(), events: [], error: error instanceof Error ? error.message : "No se pudo consultar el calendario" },
      { status: 502 },
    );
  }
}

function normalizeEvent(item: FinanceCalendarEvent, index: number) {
  const sourceName = item.name || item.title || "Evento económico";
  const event = translateEconomicEvent(sourceName);
  const country = inferCountry(`${item.name ?? ""} ${item.title ?? ""}`);
  const actual = translateValue(item.actual);
  const forecast = translateValue(item.consensus);
  const impact = assessCryptoImpact({ event, category: item.category ?? "", actual, forecast });
  const date = item.time_utc || `${item.date}T00:00:00Z`;
  return {
    id: `${item.date}-${slug(sourceName)}-${index}`,
    date,
    country: country.name,
    countryCode: country.code,
    category: item.category ?? "",
    event,
    actual,
    forecast,
    previous: translateValue(item.prior),
    importance: item.impact === "high" ? 3 : item.impact === "medium" ? 2 : 1,
    source: "Finance Calendar",
    sourceUrl: safeHttpUrl(item.url),
    ...impact,
  };
}

function translateValue(value?: string | null): string {
  if (!value) return "—";
  return value
    .replace(/^Widely expected to remain on…$/i, "Se espera que se mantenga…")
    .replace(/^Economists widely expect the…$/i, "Consenso de continuidad…")
    .replace(/^Around ([\d,.]+) to ([\d,.]+) ne…$/i, "Entre $1 y $2…")
    .replace(/^Held at /i, "Se mantuvo en ")
    .replace(/^Hold at /i, "Mantener en ")
    .replace(/^Hold$/i, "Mantener")
    .replace(/annualised units/gi, "unidades anualizadas");
}

function inferCountry(value: string): { name: string; code: string } {
  const text = value.toLowerCase();
  if (/\bus\b|united states|fomc|federal reserve/.test(text)) return { name: "Estados Unidos", code: "US" };
  if (/germany|ifo/.test(text)) return { name: "Alemania", code: "DE" };
  if (/ecb|euro area|eurozone/.test(text)) return { name: "Zona euro", code: "EU" };
  if (/snb|switzerland/.test(text)) return { name: "Suiza", code: "CH" };
  if (/riksbank|sweden/.test(text)) return { name: "Suecia", code: "SE" };
  if (/norges|norway/.test(text)) return { name: "Noruega", code: "NO" };
  if (/rba|australia/.test(text)) return { name: "Australia", code: "AU" };
  if (/boe|united kingdom|\buk\b/.test(text)) return { name: "Reino Unido", code: "GB" };
  if (/boj|japan/.test(text)) return { name: "Japón", code: "JP" };
  if (/boc|canada/.test(text)) return { name: "Canadá", code: "CA" };
  if (/rbnz|new zealand/.test(text)) return { name: "Nueva Zelanda", code: "NZ" };
  if (/pboc|china/.test(text)) return { name: "China", code: "CN" };
  return { name: "Global", code: "GL" };
}

function dateRange(range: string): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "tomorrow") start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  if (range === "week") end.setUTCDate(end.getUTCDate() + 7);
  return { start: isoDay(start), end: isoDay(end) };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function safeHttpUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
