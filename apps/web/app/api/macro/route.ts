import { classifyScenario } from "../../../lib/macro/impact";
import type {
  MacroEvent,
  MacroEventKind,
  MacroImpact,
  SourceHealth,
} from "../../../lib/macro/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOREX_FACTORY_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const BLS_ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics";
const BLS_SCHEDULE_URL = "https://www.bls.gov/schedule/2026/";
const BEA_RELEASES_URL = "https://apps.bea.gov/API/signup/release_dates.json";
const BEA_SCHEDULE_URL = "https://www.bea.gov/news/schedule";
const FED_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const FOREX_FACTORY_CALENDAR_URL = "https://www.forexfactory.com/calendar";

const DAY = 86_400_000;
const EVENT_WINDOW_BEFORE = 3 * DAY;
const EVENT_WINDOW_AFTER = 45 * DAY;
const FETCH_TIMEOUT_MS = 8_000;

interface ForexFactoryEvent {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  actual?: unknown;
}

interface BeaReleaseGroup {
  release_dates?: unknown;
}

type BeaResponse = Record<string, BeaReleaseGroup | string | unknown>;

type OfficialSeed = Omit<MacroEvent, "previous" | "forecast" | "actual" | "scenario" | "expectationsSource">;

const FOMC_DECISIONS: Array<{ date: string; reference: string }> = [
  { date: "2026-01-28T14:00:00-05:00", reference: "Reunión 27-28 ene 2026" },
  { date: "2026-03-18T14:00:00-04:00", reference: "Reunión 17-18 mar 2026" },
  { date: "2026-04-29T14:00:00-04:00", reference: "Reunión 28-29 abr 2026" },
  { date: "2026-06-17T14:00:00-04:00", reference: "Reunión 16-17 jun 2026" },
  { date: "2026-07-29T14:00:00-04:00", reference: "Reunión 28-29 jul 2026" },
  { date: "2026-09-16T14:00:00-04:00", reference: "Reunión 15-16 sep 2026" },
  { date: "2026-10-28T14:00:00-04:00", reference: "Reunión 27-28 oct 2026" },
  { date: "2026-12-09T14:00:00-05:00", reference: "Reunión 8-9 dic 2026" },
  { date: "2027-01-27T14:00:00-05:00", reference: "Reunión 26-27 ene 2027" },
  { date: "2027-03-17T14:00:00-04:00", reference: "Reunión 16-17 mar 2027" },
  { date: "2027-04-28T14:00:00-04:00", reference: "Reunión 27-28 abr 2027" },
  { date: "2027-06-09T14:00:00-04:00", reference: "Reunión 8-9 jun 2027" },
  { date: "2027-07-28T14:00:00-04:00", reference: "Reunión 27-28 jul 2027" },
  { date: "2027-09-15T14:00:00-04:00", reference: "Reunión 14-15 sep 2027" },
  { date: "2027-10-27T14:00:00-04:00", reference: "Reunión 26-27 oct 2027" },
  { date: "2027-12-08T14:00:00-05:00", reference: "Reunión 7-8 dic 2027" },
];

const BLS_2026_FALLBACK = {
  cpi: [
    "2026-10-14T08:30:00-04:00",
    "2026-11-10T08:30:00-05:00",
    "2026-12-10T08:30:00-05:00",
  ],
  employment: [
    "2026-10-02T08:30:00-04:00",
    "2026-11-06T08:30:00-05:00",
    "2026-12-04T08:30:00-05:00",
  ],
} as const;

export async function GET() {
  const now = Date.now();
  const [blsResult, beaResult, forexResult] = await Promise.allSettled([
    fetchText(BLS_ICS_URL, 3_600),
    fetchJson<BeaResponse>(BEA_RELEASES_URL, 3_600),
    fetchJson<ForexFactoryEvent[]>(FOREX_FACTORY_URL, 60),
  ]);

  const blsUsingFallback = blsResult.status === "rejected";
  const sources: SourceHealth[] = [
    blsUsingFallback
      ? {
          id: "bls",
          label: "BLS",
          status: "degraded",
          detail:
            "El ICS de BLS rechazó la consulta serverless; se usa el calendario oficial 2026 integrado como respaldo para CPI y empleo.",
        }
      : {
          id: "bls",
          label: "BLS",
          status: "ok",
          detail: "Calendario oficial de CPI y empleo",
        },
    healthFromResult("bea", "BEA", beaResult, "Calendario oficial de GDP y PCE"),
    {
      id: "fed",
      label: "Federal Reserve",
      status: "ok",
      detail: "Calendario oficial FOMC 2026-2027 publicado por la Reserva Federal",
    },
    healthFromResult(
      "expectations",
      "Forex Factory",
      forexResult,
      "Consenso, anterior y dato real del export semanal. Eventos de semanas posteriores pueden aparecer sin consenso hasta que la fuente los publique.",
      "degraded",
    ),
  ];

  const official: OfficialSeed[] = [];
  if (blsResult.status === "fulfilled") official.push(...parseBlsCalendar(blsResult.value));
  else official.push(...blsFallbackSeeds());
  if (beaResult.status === "fulfilled") official.push(...parseBeaCalendar(beaResult.value));
  official.push(...fomcSeeds());

  const expectations =
    forexResult.status === "fulfilled" && Array.isArray(forexResult.value)
      ? parseForexFactory(forexResult.value)
      : [];

  const merged = mergeExpectations(official, expectations)
    .filter((event) => event.timestamp >= now - EVENT_WINDOW_BEFORE)
    .filter((event) => event.timestamp <= now + EVENT_WINDOW_AFTER)
    .sort((a, b) => a.timestamp - b.timestamp);

  return Response.json(
    { generatedAt: now, events: merged, sources },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}

async function fetchText(url: string, revalidate: number): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MarketIntelligenceDashboard/1.0; +https://github.com/ramisoaresgache/market-intelligence-dashboard)",
      Accept: "text/calendar,text/plain,text/html,application/xml;q=0.9,*/*;q=0.8",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MarketIntelligenceDashboard/1.0",
      Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function healthFromResult<T>(
  id: string,
  label: string,
  result: PromiseSettledResult<T>,
  okDetail: string,
  failureStatus: SourceHealth["status"] = "error",
): SourceHealth {
  return result.status === "fulfilled"
    ? { id, label, status: "ok", detail: okDetail }
    : {
        id,
        label,
        status: failureStatus,
        detail: cleanError(result.reason),
      };
}

function cleanError(reason: unknown): string {
  return reason instanceof Error ? reason.message.slice(0, 140) : "Fuente temporalmente no disponible";
}

function parseBlsCalendar(ics: string): OfficialSeed[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  const events: OfficialSeed[] = [];

  for (const block of blocks) {
    const summary = icsValue(block, "SUMMARY") ?? "";
    const rawStart = icsValue(block, "DTSTART");
    const timestamp = rawStart ? parseIcsTimestamp(rawStart) : null;
    if (timestamp == null) continue;

    if (/consumer price index/i.test(summary)) {
      events.push(officialEvent("cpi", "CPI", timestamp, "BLS", BLS_SCHEDULE_URL));
      events.push(officialEvent("core-cpi", "Core CPI", timestamp, "BLS", BLS_SCHEDULE_URL));
    }
    if (/employment situation/i.test(summary)) {
      events.push(officialEvent("nfp", "NFP · Nonfarm Payrolls", timestamp, "BLS", BLS_SCHEDULE_URL));
      events.push(
        officialEvent("unemployment", "Tasa de desempleo", timestamp, "BLS", BLS_SCHEDULE_URL),
      );
    }
  }

  return dedupeOfficial(events);
}

function blsFallbackSeeds(): OfficialSeed[] {
  const events: OfficialSeed[] = [];

  for (const date of BLS_2026_FALLBACK.cpi) {
    const timestamp = Date.parse(date);
    events.push(officialEvent("cpi", "CPI", timestamp, "BLS · calendario de respaldo", BLS_SCHEDULE_URL));
    events.push(
      officialEvent("core-cpi", "Core CPI", timestamp, "BLS · calendario de respaldo", BLS_SCHEDULE_URL),
    );
  }

  for (const date of BLS_2026_FALLBACK.employment) {
    const timestamp = Date.parse(date);
    events.push(
      officialEvent("nfp", "NFP · Nonfarm Payrolls", timestamp, "BLS · calendario de respaldo", BLS_SCHEDULE_URL),
    );
    events.push(
      officialEvent(
        "unemployment",
        "Tasa de desempleo",
        timestamp,
        "BLS · calendario de respaldo",
        BLS_SCHEDULE_URL,
      ),
    );
  }

  return events;
}

function icsValue(block: string, key: string): string | null {
  const line = block
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${key}:`) || item.startsWith(`${key};`));
  if (!line) return null;
  return line.slice(line.indexOf(":") + 1).trim();
}

function parseIcsTimestamp(value: string): number | null {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return finiteTimestamp(Date.parse(iso));
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    const offset = easternOffset(year, month, day);
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}${offset}`;
    return finiteTimestamp(Date.parse(iso));
  }
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return finiteTimestamp(
      Date.parse(
        `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T08:30:00${easternOffset(year, month, day)}`,
      ),
    );
  }
  return finiteTimestamp(Date.parse(value));
}

function easternOffset(year: number, month: number, day: number): "-04:00" | "-05:00" {
  const secondSundayInMarch = nthWeekdayOfMonth(year, 3, 0, 2);
  const firstSundayInNovember = nthWeekdayOfMonth(year, 11, 0, 1);
  const ymd = year * 10_000 + month * 100 + day;
  const dstStart = year * 10_000 + 3 * 100 + secondSundayInMarch;
  const dstEnd = year * 10_000 + 11 * 100 + firstSundayInNovember;
  return ymd >= dstStart && ymd < dstEnd ? "-04:00" : "-05:00";
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
}

function parseBeaCalendar(payload: BeaResponse): OfficialSeed[] {
  const events: OfficialSeed[] = [];
  for (const timestamp of releaseDates(payload["Gross Domestic Product"])) {
    events.push(officialEvent("gdp", "GDP · Producto Interno Bruto", timestamp, "BEA", BEA_SCHEDULE_URL));
  }
  for (const timestamp of releaseDates(payload["Personal Income and Outlays"])) {
    events.push(officialEvent("pce", "PCE Price Index", timestamp, "BEA", BEA_SCHEDULE_URL));
    events.push(officialEvent("core-pce", "Core PCE Price Index", timestamp, "BEA", BEA_SCHEDULE_URL));
  }
  return dedupeOfficial(events);
}

function releaseDates(group: unknown): number[] {
  if (!group || typeof group !== "object" || !("release_dates" in group)) return [];
  const dates = (group as BeaReleaseGroup).release_dates;
  if (!Array.isArray(dates)) return [];
  return dates
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
}

function fomcSeeds(): OfficialSeed[] {
  return FOMC_DECISIONS.map(({ date, reference }) => ({
    ...officialEvent(
      "fomc",
      "Decisión FOMC · tasa de fondos federales",
      Date.parse(date),
      "Federal Reserve",
      FED_CALENDAR_URL,
    ),
    reference,
  }));
}

function officialEvent(
  kind: MacroEventKind,
  title: string,
  timestamp: number,
  source: string,
  sourceUrl: string,
): OfficialSeed {
  return {
    id: `${kind}-${timestamp}`,
    kind,
    title,
    timestamp,
    impact: "high",
    reference: null,
    source,
    sourceUrl,
    verifiedOfficial: true,
  };
}

function dedupeOfficial(events: OfficialSeed[]): OfficialSeed[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.kind}-${event.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseForexFactory(rows: ForexFactoryEvent[]): MacroEvent[] {
  return rows.flatMap((row, index) => {
    const country = asString(row.country);
    const title = asString(row.title);
    const date = asString(row.date);
    if (country !== "USD" || !title || !date) return [];

    const kind = inferKind(title);
    const timestamp = finiteTimestamp(Date.parse(date));
    if (!kind || timestamp == null) return [];

    const previous = nullableString(row.previous);
    const forecast = nullableString(row.forecast);
    const actual = nullableString(row.actual);
    const scenario = classifyScenario(kind, actual, forecast);

    return [
      {
        id: `expectation-${kind}-${timestamp}-${index}`,
        kind,
        title: displayTitle(kind, title),
        timestamp,
        impact: mapImpact(asString(row.impact)),
        reference: null,
        previous,
        forecast,
        actual,
        scenario,
        source: "Forex Factory",
        sourceUrl: FOREX_FACTORY_CALENDAR_URL,
        expectationsSource: "Forex Factory",
        verifiedOfficial: false,
      },
    ];
  });
}

function inferKind(title: string): MacroEventKind | null {
  const text = title.toLowerCase();
  if (text.includes("powell")) return "powell";
  if (/federal funds rate|fomc statement|fomc press conference/.test(text)) return "fomc";
  if (/core pce/.test(text)) return "core-pce";
  if (/pce price index/.test(text)) return "pce";
  if (/core cpi/.test(text)) return "core-cpi";
  if (/\bcpi\b|consumer price index/.test(text)) return "cpi";
  if (/non-farm|nonfarm|payroll/.test(text)) return "nfp";
  if (/unemployment rate/.test(text)) return "unemployment";
  if (/\bgdp\b|gross domestic product/.test(text)) return "gdp";
  return null;
}

function displayTitle(kind: MacroEventKind, fallback: string): string {
  const titles: Partial<Record<MacroEventKind, string>> = {
    cpi: "CPI",
    "core-cpi": "Core CPI",
    pce: "PCE Price Index",
    "core-pce": "Core PCE Price Index",
    nfp: "NFP · Nonfarm Payrolls",
    unemployment: "Tasa de desempleo",
    gdp: "GDP · Producto Interno Bruto",
    fomc: "Decisión / comunicación FOMC",
  };
  return titles[kind] ?? fallback;
}

function mapImpact(value: string | null): MacroImpact {
  if (!value) return "medium";
  if (/high/i.test(value)) return "high";
  if (/medium/i.test(value)) return "medium";
  return "low";
}

function mergeExpectations(official: OfficialSeed[], expectations: MacroEvent[]): MacroEvent[] {
  const unused = new Set(expectations.map((_, index) => index));
  const merged = official.map((event): MacroEvent => {
    const best = findExpectation(event, expectations, unused);
    if (!best) return { ...event, previous: null, forecast: null, actual: null, scenario: null };

    unused.delete(best.index);
    const expectation = best.event;
    const actual = expectation.actual ?? null;
    const forecast = expectation.forecast ?? null;
    return {
      ...event,
      impact: expectation.impact === "low" ? event.impact : expectation.impact,
      previous: expectation.previous ?? null,
      forecast,
      actual,
      scenario: classifyScenario(event.kind, actual, forecast),
      expectationsSource: "Forex Factory",
    };
  });

  for (const index of unused) merged.push(expectations[index]);
  return dedupeMerged(merged);
}

function findExpectation(
  official: OfficialSeed,
  expectations: MacroEvent[],
  unused: Set<number>,
): { event: MacroEvent; index: number } | null {
  let best: { event: MacroEvent; index: number; distance: number } | null = null;
  for (let index = 0; index < expectations.length; index += 1) {
    if (!unused.has(index)) continue;
    const candidate = expectations[index];
    if (candidate.kind !== official.kind) continue;
    const distance = Math.abs(candidate.timestamp - official.timestamp);
    const tolerance = official.kind === "fomc" ? 12 * 3_600_000 : 36 * 3_600_000;
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { event: candidate, index, distance };
  }
  return best ? { event: best.event, index: best.index } : null;
}

function dedupeMerged(events: MacroEvent[]): MacroEvent[] {
  const sorted = [...events].sort((a, b) => {
    if (a.verifiedOfficial !== b.verifiedOfficial) return a.verifiedOfficial ? -1 : 1;
    return a.timestamp - b.timestamp;
  });
  const kept: MacroEvent[] = [];
  for (const event of sorted) {
    const duplicate = kept.some(
      (item) => item.kind === event.kind && Math.abs(item.timestamp - event.timestamp) < 2 * 3_600_000,
    );
    if (!duplicate) kept.push(event);
  }
  return kept;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  const text = asString(value);
  return text && text !== "-" ? text : null;
}

function finiteTimestamp(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
