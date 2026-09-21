import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4";
const SOSOVALUE_BASE = "https://openapi.sosovalue.com/openapi/v1";
const ETF_ASSETS = ["BTC", "ETH", "SOL"] as const;

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

type SoSoEtfRow = {
  date?: string;
  total_net_inflow?: string | number;
  total_value_traded?: string | number;
  total_net_assets?: string | number;
  cum_net_inflow?: string | number;
};

export async function GET() {
  const warnings: string[] = [];
  const sosoApiKey = process.env.SOSOVALUE_API_KEY?.trim();

  const exchangePromise = loadBitcoinExchangeFlows();
  const etfPromises = sosoApiKey
    ? ETF_ASSETS.map((asset) => loadSoSoValueFlows(asset, sosoApiKey))
    : ETF_ASSETS.map((asset) =>
        Promise.resolve({
          asset,
          source: "SoSoValue Demo API",
          available: false as const,
          requiresConfig: true,
          error: "Falta configurar SOSOVALUE_API_KEY (plan Demo gratuito).",
        }),
      );

  const [exchangeResult, ...etfResults] = await Promise.allSettled([
    exchangePromise,
    ...etfPromises,
  ]);

  const bitcoinExchange =
    exchangeResult.status === "fulfilled"
      ? exchangeResult.value
      : (warnings.push(`Coin Metrics: ${errorMessage(exchangeResult.reason)}`), null);

  const etfs = ETF_ASSETS.map((asset, index) => {
    const result = etfResults[index];
    if (result.status === "fulfilled") return result.value;
    const message = errorMessage(result.reason);
    warnings.push(`${asset} ETF: ${message}`);
    return {
      asset,
      source: "SoSoValue Demo API",
      available: false as const,
      error: message,
    };
  });

  return NextResponse.json(
    {
      generatedAt: Date.now(),
      bitcoinExchange,
      etfs,
      warnings,
      etfProviderConfigured: Boolean(sosoApiKey),
      methodology: {
        exchangeFlows:
          "Coin Metrics FlowInEx/FlowOutEx: movimientos diarios de BTC hacia/desde direcciones identificadas como exchanges, excluyendo transferencias entre exchanges.",
        etfFlows:
          "SoSoValue ETF Summary History: flujo neto diario agregado de ETF spot de EE.UU. para BTC, ETH y SOL. El plan Demo es gratuito y requiere una API key server-side.",
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

async function loadSoSoValueFlows(asset: (typeof ETF_ASSETS)[number], apiKey: string) {
  const params = new URLSearchParams({
    symbol: asset,
    country_code: "US",
    limit: "14",
  });
  const response = await fetch(`${SOSOVALUE_BASE}/etfs/summary-history?${params}`, {
    headers: {
      Accept: "application/json",
      "x-soso-api-key": apiKey,
    },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const raw = (await response.json()) as unknown;
  const rows = extractSoSoRows(raw)
    .filter((row) => row.date && Number.isFinite(Number(row.total_net_inflow)))
    .sort((a, b) => Date.parse(a.date ?? "") - Date.parse(b.date ?? ""));
  if (!rows.length) throw new Error("SoSoValue no devolvió histórico ETF");

  const recent7 = rows.slice(-7);
  const latest = recent7.at(-1)!;
  return {
    asset,
    source: "SoSoValue Demo API",
    available: true as const,
    date: latest.date,
    dailyFlowUsd: numberValue(latest.total_net_inflow),
    fiveDayFlowUsd: recent7.slice(-5).reduce((sum, row) => sum + numberValue(row.total_net_inflow), 0),
    sevenDayFlowUsd: recent7.reduce((sum, row) => sum + numberValue(row.total_net_inflow), 0),
    netAssetsUsd: nullableNumber(latest.total_net_assets),
    cumulativeFlowUsd: nullableNumber(latest.cum_net_inflow),
    valueTradedUsd: nullableNumber(latest.total_value_traded),
  };
}

function extractSoSoRows(value: unknown): SoSoEtfRow[] {
  if (Array.isArray(value)) return value.filter(isRecord) as SoSoEtfRow[];
  if (!isRecord(value)) return [];

  const data = value.data;
  if (Array.isArray(data)) return data.filter(isRecord) as SoSoEtfRow[];
  if (isRecord(data)) {
    for (const key of ["list", "items", "records"]) {
      const candidate = data[key];
      if (Array.isArray(candidate)) return candidate.filter(isRecord) as SoSoEtfRow[];
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
