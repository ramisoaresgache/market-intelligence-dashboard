import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4";
const SOSOVALUE_BASE = "https://openapi.sosovalue.com/openapi/v1";
const ETF_ASSETS = ["BTC", "ETH", "SOL"] as const;
const HISTORY_DAYS = 370;

const EXCHANGES = [
  { id: "binance", name: "Binance", code: "BNB" },
  { id: "coinbase", name: "Coinbase", code: "CBS" },
  { id: "bitfinex", name: "Bitfinex", code: "BFX" },
  { id: "kraken", name: "Kraken", code: "KRK" },
  { id: "okx", name: "OKX", code: "OKX" },
  { id: "gemini", name: "Gemini", code: "GEM" },
  { id: "bybit", name: "Bybit", code: "BIT" },
  { id: "gate", name: "Gate.io", code: "GIO" },
  { id: "bitstamp", name: "Bitstamp", code: "BSP" },
  { id: "kucoin", name: "KuCoin", code: "KCN" },
  { id: "mexc", name: "MEXC", code: "MXC" },
  { id: "bitmex", name: "BitMEX", code: "BMX" },
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
  [metric: string]: string | undefined;
};

type ExchangeHistoryPoint = {
  date: string;
  reserveBtc: number | null;
  inflowBtc: number | null;
  outflowBtc: number | null;
  priceUsd: number | null;
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
          source: "SoSoValue ETF API",
          available: false as const,
          requiresConfig: true,
          error: "Falta configurar SOSOVALUE_API_KEY.",
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
      source: "SoSoValue ETF API",
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
          "Coin Metrics FlowIn/FlowOut: BTC enviado hacia o retirado desde direcciones identificadas como exchanges. Sply mide BTC retenido en wallets identificadas del exchange. Las cifras son estimaciones on-chain y pueden subestimar saldos reales si faltan direcciones por identificar.",
        exchangeDetail:
          "Coin Metrics Community permite el agregado de BTC, pero algunas métricas de desglose por exchange requieren credenciales con mayor cobertura. Si no están autorizadas, el dashboard conserva los gráficos agregados sin mostrar un error técnico al usuario.",
        etfFlows:
          "SoSoValue ETF Summary History: datos reales del dataset de ETF spot de EE.UU. para BTC, ETH y SOL. 'Demo' es el nombre del plan gratuito de acceso a la API, no un dataset ficticio.",
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
  const start = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    assets: "btc",
    metrics: "FlowInExUSD,FlowOutExUSD,FlowInExNtv,FlowOutExNtv,SplyExNtv,SplyExUSD,PriceUSD",
    frequency: "1d",
    start_time: start,
    page_size: "1000",
  });

  const response = await fetch(`${COINMETRICS_BASE}/timeseries/asset-metrics?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const payload = (await response.json()) as { data?: CoinMetricsRow[] };
  const rows = sortRows(payload.data ?? []);
  if (!rows.length) throw new Error("Sin datos de exchange flows para BTC");

  const history: ExchangeHistoryPoint[] = rows.map((row) => ({
    date: row.time!,
    reserveBtc: nullableNumber(row.SplyExNtv),
    inflowBtc: nullableNumber(row.FlowInExNtv),
    outflowBtc: nullableNumber(row.FlowOutExNtv),
    priceUsd: nullableNumber(row.PriceUSD),
  }));

  const latest = rows.at(-1)!;
  const recent7 = rows.slice(-7);
  const inflowUsd = numberValue(latest.FlowInExUSD);
  const outflowUsd = numberValue(latest.FlowOutExUSD);
  const inflowBtc = numberValue(latest.FlowInExNtv);
  const outflowBtc = numberValue(latest.FlowOutExNtv);

  let exchanges: Awaited<ReturnType<typeof loadExchangeBreakdown>> = [];
  let exchangeDetailError: string | null = null;
  try {
    exchanges = await loadExchangeBreakdown(start, history);
  } catch (error) {
    exchangeDetailError = errorMessage(error);
  }

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
    history,
    exchanges,
    exchangeDetailAvailable: exchanges.length > 0,
    exchangeDetailError,
  };
}

async function loadExchangeBreakdown(start: string, aggregateHistory: ExchangeHistoryPoint[]) {
  const metrics = EXCHANGES.flatMap((exchange) => [
    `Sply${exchange.code}Ntv`,
    `FlowIn${exchange.code}Ntv`,
    `FlowOut${exchange.code}Ntv`,
  ]);
  const params = new URLSearchParams({
    assets: "btc",
    metrics: metrics.join(","),
    frequency: "1d",
    start_time: start,
    page_size: "1000",
  });

  const response = await fetch(`${COINMETRICS_BASE}/timeseries/asset-metrics?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());

  const payload = (await response.json()) as { data?: CoinMetricsRow[] };
  const rows = sortRows(payload.data ?? []);
  if (!rows.length) return [];

  const priceByDate = new Map(aggregateHistory.map((point) => [point.date, point.priceUsd]));

  return EXCHANGES.flatMap((exchange) => {
    const reserveKey = `Sply${exchange.code}Ntv`;
    const inflowKey = `FlowIn${exchange.code}Ntv`;
    const outflowKey = `FlowOut${exchange.code}Ntv`;
    const history = rows
      .map((row) => ({
        date: row.time!,
        reserveBtc: nullableNumber(row[reserveKey]),
        inflowBtc: nullableNumber(row[inflowKey]),
        outflowBtc: nullableNumber(row[outflowKey]),
        priceUsd: priceByDate.get(row.time!) ?? null,
      }))
      .filter((point) => point.reserveBtc != null || point.inflowBtc != null || point.outflowBtc != null);

    const latest = [...history].reverse().find((point) => point.reserveBtc != null);
    if (!latest?.reserveBtc) return [];

    return [
      {
        id: exchange.id,
        name: exchange.name,
        balanceBtc: latest.reserveBtc,
        change1dBtc: changeFrom(history, 1),
        change7dBtc: changeFrom(history, 7),
        change30dBtc: changeFrom(history, 30),
        inflowBtc: latest.inflowBtc,
        outflowBtc: latest.outflowBtc,
        history,
      },
    ];
  }).sort((a, b) => b.balanceBtc - a.balanceBtc);
}

function changeFrom(history: ExchangeHistoryPoint[], days: number): number | null {
  const balances = history.filter((point) => point.reserveBtc != null);
  if (balances.length <= days) return null;
  const latest = balances.at(-1)?.reserveBtc;
  const previous = balances.at(-(days + 1))?.reserveBtc;
  if (latest == null || previous == null) return null;
  return latest - previous;
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
    source: "SoSoValue ETF API",
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

function sortRows(rows: CoinMetricsRow[]) {
  return rows
    .filter((row) => row.time)
    .sort((a, b) => Date.parse(a.time ?? "") - Date.parse(b.time ?? ""));
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
