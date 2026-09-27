import { NextRequest, NextResponse } from "next/server";
import { assessCryptoImpact, translateEconomicEvent } from "../../../lib/news/economic-impact";

export const dynamic = "force-dynamic";

const TRADING_VIEW_COUNTRIES = [
  "AR", "AU", "BR", "CA", "CH", "CN", "DE", "ES", "EU", "FR", "GB", "HK", "ID",
  "IN", "IT", "JP", "KR", "MX", "NO", "NZ", "RU", "SA", "SE", "TR", "US", "ZA",
].join(",");

type TradingViewEvent = {
  id?: string | number;
  title?: string;
  country?: string;
  indicator?: string;
  category?: string;
  period?: string;
  source?: string;
  source_url?: string;
  actual?: string | number | null;
  previous?: string | number | null;
  forecast?: string | number | null;
  unit?: string;
  scale?: string;
  importance?: number;
  date?: string;
};

type TradingViewResponse = {
  status?: string;
  result?: TradingViewEvent[];
};

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
  const dates = dateRange(range);

  try {
    const events = await fetchTradingViewCalendar(dates.startDate, dates.endDate);
    if (!events.length) throw new Error("TradingView no devolvió eventos para el rango solicitado");

    return NextResponse.json(
      {
        state: "live",
        fetchedAt: new Date().toISOString(),
        events,
        fallback: false,
        attribution: {
          source: "TradingView Economic Calendar",
          url: "https://www.tradingview.com/economic-calendar/",
          terms: "Fuente pública sin garantía contractual de disponibilidad.",
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } },
    );
  } catch (primaryError) {
    try {
      const fallback = await fetchFinanceCalendar(dates.startDay, dates.endDay);
      return NextResponse.json(
        {
          state: "live",
          fetchedAt: new Date().toISOString(),
          events: fallback.events,
          fallback: true,
          message: "La fuente global no respondió; se muestra una cobertura reducida de respaldo.",
          attribution: fallback.attribution,
        },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
      );
    } catch (fallbackError) {
      return NextResponse.json(
        {
          state: "unavailable",
          fetchedAt: new Date().toISOString(),
          events: [],
          error: `No se pudo consultar el calendario global ni el respaldo: ${errorMessage(primaryError)}; ${errorMessage(fallbackError)}`,
        },
        { status: 502 },
      );
    }
  }
}

async function fetchTradingViewCalendar(start: Date, end: Date) {
  const endpoint = new URL("https://economic-calendar.tradingview.com/events");
  endpoint.searchParams.set("from", start.toISOString());
  endpoint.searchParams.set("to", end.toISOString());
  endpoint.searchParams.set("countries", TRADING_VIEW_COUNTRIES);

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Origin: "https://www.tradingview.com",
      Referer: "https://www.tradingview.com/",
    },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`TradingView respondió ${response.status}`);

  const payload = await response.json() as TradingViewResponse;
  if (payload.status && payload.status !== "ok") throw new Error(`TradingView respondió ${payload.status}`);

  return (payload.result ?? [])
    .filter((item) => item.date && (item.title || item.indicator))
    .map(normalizeTradingViewEvent)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

async function fetchFinanceCalendar(start: string, end: string) {
  const endpoint = new URL("https://www.financecalendar.com/wp-json/fc/v1/calendar");
  endpoint.searchParams.set("from", start);
  endpoint.searchParams.set("to", end);
  endpoint.searchParams.set("limit", "250");

  const response = await fetch(endpoint, { next: { revalidate: 120 }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Finance Calendar respondió ${response.status}`);
  const payload = await response.json() as FinanceCalendarResponse;
  const events = (payload.events ?? [])
    .filter((item) => item.date && (item.name || item.title))
    .map((item, index) => normalizeFinanceEvent(item, index))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (!events.length) throw new Error("Finance Calendar no devolvió eventos");

  return {
    events,
    attribution: {
      source: payload.attribution?.source ?? "Finance Calendar",
      url: "https://www.financecalendar.com",
      terms: payload.attribution?.terms ?? "Uso gratuito con atribución.",
    },
  };
}

function normalizeTradingViewEvent(item: TradingViewEvent, index: number) {
  const sourceName = item.title || item.indicator || "Evento económico";
  const event = translateTradingViewEvent(sourceName, item.period);
  const actual = formatEconomicValue(item.actual, item.unit, item.scale);
  const forecast = formatEconomicValue(item.forecast, item.unit, item.scale);
  const previous = formatEconomicValue(item.previous, item.unit, item.scale);
  const category = `${item.category ?? ""} ${item.indicator ?? ""}`.trim();
  const impact = assessCryptoImpact({
    event,
    category,
    actual: rawEconomicValue(item.actual),
    forecast: rawEconomicValue(item.forecast),
  });
  const country = countryDetails(item.country);
  const rawImportance = typeof item.importance === "number" ? item.importance : -1;

  return {
    id: String(item.id ?? `${item.date}-${slug(sourceName)}-${index}`),
    date: item.date as string,
    country: country.name,
    countryCode: country.code,
    category,
    event,
    actual,
    forecast,
    previous,
    importance: Math.max(1, Math.min(3, rawImportance + 2)),
    source: item.source || "TradingView",
    sourceUrl: safeHttpUrl(item.source_url),
    ...impact,
  };
}

function normalizeFinanceEvent(item: FinanceCalendarEvent, index: number) {
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

const titleTranslations: Array<[RegExp, string]> = [
  [/New Car Registrations/gi, "Registro de automóviles"],
  [/Day following the Mid-Autumn Festival/gi, "Día posterior al Festival del Medio Otoño"],
  [/Mid-Autumn Festival/gi, "Festival del Medio Otoño"],
  [/BoJ Monetary Policy Meeting Minutes/gi, "Minutas de política monetaria del BoJ"],
  [/BoJ JGB Purchase/gi, "Compra de bonos JGB del BoJ"],
  [/Money Supply M2/gi, "Masa monetaria M2"],
  [/Business Expectations/gi, "Expectativas empresariales"],
  [/Current Assessment/gi, "Situación actual"],
  [/Business Climate/gi, "Clima empresarial"],
  [/Economic Bulletin/gi, "Boletín económico"],
  [/Interest Rate Decision/gi, "Decisión de tipos de interés"],
  [/Monetary Policy Assessment/gi, "Evaluación de política monetaria"],
  [/Press Conference/gi, "Rueda de prensa"],
  [/Balance of Trade|Trade Balance/gi, "Balanza comercial"],
  [/Consumer Confidence/gi, "Confianza del consumidor"],
  [/Building Permits/gi, "Permisos de construcción"],
  [/Current Account/gi, "Cuenta corriente"],
  [/Industrial Profits/gi, "Ganancias industriales"],
  [/Industrial Production/gi, "Producción industrial"],
  [/Manufacturing Production/gi, "Producción manufacturera"],
  [/Foreign Direct Investment/gi, "Inversión extranjera directa"],
  [/Business Confidence/gi, "Confianza empresarial"],
  [/Continuing Jobless Claims/gi, "Renovaciones de los subsidios de desempleo"],
  [/Initial Jobless Claims/gi, "Nuevas peticiones de subsidio por desempleo"],
  [/Jobless Claims 4-week Average/gi, "Solicitudes de desempleo, promedio de 4 semanas"],
  [/Retail Sales Ex Autos/gi, "Ventas minoristas subyacentes"],
  [/Retail Sales/gi, "Ventas minoristas"],
  [/Average Weekly Earnings/gi, "Salario medio semanal"],
  [/Average Hourly Earnings/gi, "Ingresos medios por hora"],
  [/Manufacturing Sales/gi, "Ventas del sector manufacturero"],
  [/New Home Sales/gi, "Ventas de viviendas nuevas"],
  [/Natural Gas Stocks|Natural Gas Storage/gi, "Reservas de gas natural"],
  [/Kansas City Fed Composite Index/gi, "Índice compuesto de la Fed de Kansas City"],
  [/Kansas City Fed Manufacturing Index/gi, "Índice manufacturero de la Fed de Kansas City"],
  [/Fed Balance Sheet/gi, "Balance general de la Fed"],
  [/Reserve Balances with Federal Reserve Banks/gi, "Saldos de reserva en bancos de la Reserva Federal"],
  [/Economic Activity/gi, "Actividad económica"],
  [/Core CPI/gi, "IPC subyacente"],
  [/\bCPI\b/gi, "IPC"],
  [/\bPPI\b/gi, "IPP"],
  [/Imports/gi, "Importaciones"],
  [/Exports/gi, "Exportaciones"],
  [/Unemployment Rate/gi, "Tasa de desempleo"],
  [/Unemployment Change/gi, "Variación del desempleo"],
  [/\bEmployment Change/gi, "Variación del empleo"],
  [/Manufacturing PMI/gi, "PMI manufacturero"],
  [/Services PMI/gi, "PMI de servicios"],
];

function translateTradingViewEvent(value: string, period?: string): string {
  let translated = value;
  for (const [pattern, replacement] of titleTranslations) translated = translated.replace(pattern, replacement);
  translated = translated
    .replace(/\bYoY\b/gi, "(Anual)")
    .replace(/\bMoM\b/gi, "(Mensual)")
    .replace(/\bQoQ\b/gi, "(Trimestral)")
    .replace(/\bWoW\b/gi, "(Semanal)")
    .replace(/^(.+?) Speech$/i, "Declaraciones de $1");
  if (period && !translated.toLowerCase().includes(period.toLowerCase())) translated += ` (${period})`;
  return translateEconomicEvent(translated);
}

function formatEconomicValue(value: string | number | null | undefined, unit?: string, scale?: string): string {
  if (value == null || value === "") return "—";
  const text = typeof value === "number"
    ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value)
    : String(value).trim();
  const suffix = [scale, unit].filter(Boolean).join("");
  if (!suffix || text.toLowerCase().endsWith(suffix.toLowerCase())) return text;
  return `${text}${suffix}`;
}

function rawEconomicValue(value: string | number | null | undefined): string | undefined {
  return value == null || value === "" ? undefined : String(value);
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

const countries: Record<string, string> = {
  AR: "Argentina", AU: "Australia", BR: "Brasil", CA: "Canadá", CH: "Suiza", CN: "China",
  DE: "Alemania", ES: "España", EU: "Zona euro", FR: "Francia", GB: "Reino Unido", HK: "Hong Kong",
  ID: "Indonesia", IN: "India", IT: "Italia", JP: "Japón", KR: "Corea del Sur", MX: "México",
  NO: "Noruega", NZ: "Nueva Zelanda", RU: "Rusia", SA: "Arabia Saudita", SE: "Suecia", TR: "Turquía",
  US: "Estados Unidos", ZA: "Sudáfrica",
};

function countryDetails(code?: string): { name: string; code: string } {
  const normalized = (code || "GL").toUpperCase();
  return { name: countries[normalized] ?? normalized, code: normalized };
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

function dateRange(range: string) {
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "tomorrow") startDate.setUTCDate(startDate.getUTCDate() + 1);
  const endDate = new Date(startDate);
  if (range === "week") endDate.setUTCDate(endDate.getUTCDate() + 7);
  endDate.setUTCHours(23, 59, 59, 999);
  return { startDate, endDate, startDay: isoDay(startDate), endDay: isoDay(endDate) };
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "error desconocido";
}
