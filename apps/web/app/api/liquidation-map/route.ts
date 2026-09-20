import { NextResponse } from "next/server";
import {
  estimateLiquidationZones,
  mergeCandles,
  type HistoricalCandle,
  type HistoricalOpenInterestPoint,
  type LiquidationMapExchange,
  type LiquidationMapPayload,
  type LiquidationMapSource,
} from "../../../lib/market/liquidation-model";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const BYBIT_BASE = "https://api.bybit.com";
const BINANCE_BASE = "https://fapi.binance.com";
const VALID_HOURS = new Set([4, 12, 24]);
const VALID_SOURCES = new Set<LiquidationMapSource>(["aggregate", "binance", "bybit"]);

interface ExchangeDataset {
  exchange: LiquidationMapExchange;
  candles: HistoricalCandle[];
  openInterest: HistoricalOpenInterestPoint[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceParam = (url.searchParams.get("source") ?? "aggregate") as LiquidationMapSource;
  const hoursParam = Number(url.searchParams.get("hours") ?? "24");

  let symbol: string;
  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  if (!VALID_HOURS.has(hoursParam)) {
    return NextResponse.json({ error: "Período no válido. Usá 4, 12 o 24 horas." }, { status: 400 });
  }
  if (!VALID_SOURCES.has(sourceParam)) {
    return NextResponse.json({ error: "Fuente no válida" }, { status: 400 });
  }

  const end = Date.now();
  const start = end - hoursParam * 60 * 60 * 1000;
  const exchanges: LiquidationMapExchange[] =
    sourceParam === "aggregate" ? ["binance", "bybit"] : [sourceParam];

  const settled = await Promise.allSettled(
    exchanges.map((exchange) =>
      exchange === "binance"
        ? fetchBinanceDataset(symbol, start, end)
        : fetchBybitDataset(symbol, start, end),
    ),
  );

  const datasets: ExchangeDataset[] = [];
  const warnings: string[] = [];
  settled.forEach((result, index) => {
    const exchange = exchanges[index];
    if (!exchange) return;
    if (result.status === "fulfilled") {
      datasets.push(result.value);
    } else {
      warnings.push(`${exchange}: ${errorMessage(result.reason)}`);
    }
  });

  if (!datasets.length) {
    return NextResponse.json(
      { error: "No se pudieron obtener datos históricos de los exchanges", warnings },
      { status: 502 },
    );
  }

  const zones = datasets.flatMap((dataset) =>
    estimateLiquidationZones(dataset.candles, dataset.openInterest, dataset.exchange),
  );
  const candles = mergeCandles(datasets.map((dataset) => dataset.candles));

  const payload: LiquidationMapPayload = {
    symbol,
    hours: hoursParam,
    requestedSource: sourceParam,
    sourcesUsed: datasets.map((dataset) => dataset.exchange),
    generatedAt: Date.now(),
    candles,
    zones,
    warnings,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=45, stale-while-revalidate=60",
    },
  });
}

async function fetchBybitDataset(
  symbol: string,
  start: number,
  end: number,
): Promise<ExchangeDataset> {
  const [candles, openInterest] = await Promise.all([
    fetchBybitCandles(symbol, start, end),
    fetchBybitOpenInterest(symbol, start, end),
  ]);
  if (!candles.length || !openInterest.length) {
    throw new Error("histórico insuficiente");
  }
  return { exchange: "bybit", candles, openInterest };
}

async function fetchBinanceDataset(
  symbol: string,
  start: number,
  end: number,
): Promise<ExchangeDataset> {
  const [candles, openInterest] = await Promise.all([
    fetchBinanceCandles(symbol, start, end),
    fetchBinanceOpenInterest(symbol, start, end),
  ]);
  if (!candles.length || !openInterest.length) {
    throw new Error("histórico insuficiente");
  }
  return { exchange: "binance", candles, openInterest };
}

async function fetchBybitCandles(
  symbol: string,
  start: number,
  end: number,
): Promise<HistoricalCandle[]> {
  const params = new URLSearchParams({
    category: "linear",
    symbol,
    interval: "5",
    start: String(start),
    end: String(end),
    limit: "1000",
  });
  const response = await fetch(`${BYBIT_BASE}/v5/market/kline?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`kline HTTP ${response.status}`);
  const payload = (await response.json()) as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: string[][] };
  };
  if (payload.retCode !== 0) throw new Error(payload.retMsg || "error al consultar velas");

  return (payload.result?.list ?? [])
    .map((item) => ({
      ts: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      turnoverUsd: Number(item[6]),
    }))
    .filter(validCandle)
    .sort((a, b) => a.ts - b.ts);
}

async function fetchBybitOpenInterest(
  symbol: string,
  start: number,
  end: number,
): Promise<HistoricalOpenInterestPoint[]> {
  const raw: Array<{ ts: number; openInterest: number }> = [];
  let cursor = "";

  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({
      category: "linear",
      symbol,
      intervalTime: "5min",
      startTime: String(start),
      endTime: String(end),
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`${BYBIT_BASE}/v5/market/open-interest?${params}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`open interest HTTP ${response.status}`);
    const payload = (await response.json()) as {
      retCode?: number;
      retMsg?: string;
      result?: {
        list?: Array<{ openInterest?: string; timestamp?: string }>;
        nextPageCursor?: string;
      };
    };
    if (payload.retCode !== 0) throw new Error(payload.retMsg || "error al consultar OI");

    for (const item of payload.result?.list ?? []) {
      const ts = Number(item.timestamp);
      const openInterest = Number(item.openInterest);
      if (Number.isFinite(ts) && Number.isFinite(openInterest) && openInterest > 0) {
        raw.push({ ts, openInterest });
      }
    }

    cursor = payload.result?.nextPageCursor ?? "";
    if (!cursor) break;
  }

  const candles = await fetchBybitCandles(symbol, start, end);
  return raw
    .map((point) => {
      const close = nearestClose(candles, point.ts);
      return {
        ts: point.ts,
        openInterestUsd: point.openInterest * close,
      };
    })
    .filter((point) => Number.isFinite(point.openInterestUsd) && point.openInterestUsd > 0)
    .sort((a, b) => a.ts - b.ts);
}

async function fetchBinanceCandles(
  symbol: string,
  start: number,
  end: number,
): Promise<HistoricalCandle[]> {
  const params = new URLSearchParams({
    symbol,
    interval: "5m",
    startTime: String(start),
    endTime: String(end),
    limit: "500",
  });
  const response = await fetch(`${BINANCE_BASE}/fapi/v1/klines?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`kline HTTP ${response.status}`);
  const payload = (await response.json()) as Array<Array<string | number>>;

  return payload
    .map((item) => ({
      ts: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      turnoverUsd: Number(item[7]),
    }))
    .filter(validCandle)
    .sort((a, b) => a.ts - b.ts);
}

async function fetchBinanceOpenInterest(
  symbol: string,
  start: number,
  end: number,
): Promise<HistoricalOpenInterestPoint[]> {
  const params = new URLSearchParams({
    symbol,
    period: "5m",
    startTime: String(start),
    endTime: String(end),
    limit: "500",
  });
  const response = await fetch(`${BINANCE_BASE}/futures/data/openInterestHist?${params}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`open interest HTTP ${response.status}`);
  const payload = (await response.json()) as Array<{
    timestamp?: number;
    sumOpenInterest?: string;
    sumOpenInterestValue?: string;
  }>;
  const candles = await fetchBinanceCandles(symbol, start, end);

  return payload
    .map((item) => {
      const ts = Number(item.timestamp);
      const directValue = Number(item.sumOpenInterestValue);
      const contracts = Number(item.sumOpenInterest);
      const fallback = contracts * nearestClose(candles, ts);
      return {
        ts,
        openInterestUsd:
          Number.isFinite(directValue) && directValue > 0 ? directValue : fallback,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.ts) &&
        Number.isFinite(point.openInterestUsd) &&
        point.openInterestUsd > 0,
    )
    .sort((a, b) => a.ts - b.ts);
}

function nearestClose(candles: HistoricalCandle[], ts: number): number {
  let close = candles.at(-1)?.close ?? 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    const candidateDistance = Math.abs(candle.ts - ts);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      close = candle.close;
    }
  }
  return close;
}

function validCandle(candle: HistoricalCandle): boolean {
  return (
    Number.isFinite(candle.ts) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
