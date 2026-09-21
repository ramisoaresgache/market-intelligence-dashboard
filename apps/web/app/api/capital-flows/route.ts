import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4";
const ETF_SOURCES = [
  { asset: "BTC", url: "https://farside.co.uk/btc/" },
  { asset: "ETH", url: "https://farside.co.uk/eth/" },
  { asset: "SOL", url: "https://farside.co.uk/sol/" },
] as const;

type CoinMetricsRow = {
  time?: string;
  FlowInExUSD?: string;
  FlowOutExUSD?: string;
  FlowInExNtv?: string;
  FlowOutExNtv?: string;
  SplyExNtv?: string;
  SplyExUSD?: string;
  PriceUSD?: string;
};

type EtfFlowRow = {
  date: string;
  ts: number;
  flowUsd: number;
};

export async function GET() {
  const warnings: string[] = [];

  const [exchangeResult, ...etfResults] = await Promise.allSettled([
    loadBitcoinExchangeFlows(),
    ...ETF_SOURCES.map((source) => loadFarsideFlows(source.asset, source.url)),
  ]);

  const bitcoinExchange =
    exchangeResult.status === "fulfilled"
      ? exchangeResult.value
      : (warnings.push(`Coin Metrics: ${errorMessage(exchangeResult.reason)}`), null);

  const etfs = ETF_SOURCES.map((source, index) => {
    const result = etfResults[index];
    if (result.status === "fulfilled") return result.value;
    warnings.push(`${source.asset} ETF: ${errorMessage(result.reason)}`);
    return {
      asset: source.asset,
      source: "Farside Investors",
      available: false,
      error: errorMessage(result.reason),
    };
  });

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      bitcoinExchange,
      etfs,
      warnings,
      methodology: {
        exchangeFlows:
          "Coin Metrics FlowInEx/FlowOutEx: movimientos diarios de BTC hacia/desde direcciones identificadas como exchanges, excluyendo transferencias entre exchanges.",
        etfFlows:
          "Flujo neto diario publicado por Farside Investors para ETF spot de BTC, ETH y SOL; valores expresados en USD.",
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
      },
    },
  );
}

async function loadBitcoinExchangeFlows() {
  const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    assets: "btc",
    metrics: "FlowInExUSD,FlowOutExUSD,FlowInExNtv,FlowOutExNtv,SplyExNtv,SplyExUSD,PriceUSD",
    frequency: "1d",
    start_time: start,
    page_size: "100",
  });

  const response = await fetch(`${COINMETRICS_BASE}/timeseries/asset-metrics?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const payload = (await response.json()) as { data?: CoinMetricsRow[] };
  const rows = (payload.data ?? [])
    .filter((row) => row.time)
    .sort((a, b) => Date.parse(a.time ?? "") - Date.parse(b.time ?? ""));
  if (!rows.length) throw new Error("Sin datos de exchange flows para BTC");

  const latest = rows.at(-1)!;
  const recent7 = rows.slice(-7);
  const inflowUsd = numberValue(latest.FlowInExUSD);
  const outflowUsd = numberValue(latest.FlowOutExUSD);
  const inflowBtc = numberValue(latest.FlowInExNtv);
  const outflowBtc = numberValue(latest.FlowOutExNtv);

  return {
    available: true,
    source: "Coin Metrics Community API",
    date: latest.time,
    inflowUsd,
    outflowUsd,
    netflowUsd: inflowUsd - outflowUsd,
    inflowBtc,
    outflowBtc,
    netflowBtc: inflowBtc - outflowBtc,
    reserveBtc: nullableNumber(latest.SplyExNtv),
    reserveUsd: nullableNumber(latest.SplyExUSD),
    priceUsd: nullableNumber(latest.PriceUSD),
    sevenDayNetflowUsd: recent7.reduce(
      (sum, row) => sum + numberValue(row.FlowInExUSD) - numberValue(row.FlowOutExUSD),
      0,
    ),
    sevenDayNetflowBtc: recent7.reduce(
      (sum, row) => sum + numberValue(row.FlowInExNtv) - numberValue(row.FlowOutExNtv),
      0,
    ),
  };
}

async function loadFarsideFlows(asset: string, url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "MarketIntelligenceDashboard/1.0 (+public market research dashboard)",
    },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const html = await response.text();
  const rows = parseFarsideRows(html);
  if (!rows.length) throw new Error("No se pudo leer la tabla de Farside");

  const recent = [...rows].sort((a, b) => b.ts - a.ts).slice(0, 7);
  const latest = recent[0];
  return {
    asset,
    source: "Farside Investors",
    available: true,
    date: latest.date,
    dailyFlowUsd: latest.flowUsd,
    fiveDayFlowUsd: recent.slice(0, 5).reduce((sum, row) => sum + row.flowUsd, 0),
    sevenDayFlowUsd: recent.reduce((sum, row) => sum + row.flowUsd, 0),
    recent,
  };
}

function parseFarsideRows(html: string): EtfFlowRow[] {
  const rows: EtfFlowRow[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) cells.push(cleanHtml(cellMatch[1]));
    if (cells.length < 2) continue;

    const date = cells[0].replace(/\s+/g, " ").trim();
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(date)) continue;

    const value = parseFarsideMillions(cells.at(-1) ?? "");
    if (value == null) continue;
    const ts = Date.parse(`${date} 00:00:00 UTC`);
    if (!Number.isFinite(ts)) continue;
    rows.push({ date, ts, flowUsd: value * 1_000_000 });
  }

  return rows;
}

function cleanHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFarsideMillions(value: string): number | null {
  const raw = value.trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const normalized = raw.replace(/[(),$+\s]/g, "").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
