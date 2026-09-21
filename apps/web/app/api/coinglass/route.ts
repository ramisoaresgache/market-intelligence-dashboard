import { NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const COINGLASS_BASE = "https://open-api-v4.coinglass.com";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let symbol: string;
  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  const apiKey = process.env.COINGLASS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      reason: "COINGLASS_API_KEY no configurada",
      minimumPlan: "Hobbyist",
      capabilities: [
        "Histórico de profundidad bid/ask de futuros",
        "Flujos diarios de ETF spot de Bitcoin",
        "Balance agregado de BTC por exchange",
      ],
    });
  }

  const base = symbol.slice(0, -4);
  const orderBookParams = new URLSearchParams({
    exchange: "Bybit",
    symbol,
    interval: "4h",
    limit: "12",
    range: "1",
  });
  const balanceParams = new URLSearchParams({ symbol: base });

  const [orderBookResult, etfResult, balanceResult] = await Promise.allSettled([
    coinglassFetch(`/api/futures/orderbook/ask-bids-history?${orderBookParams}`, apiKey),
    coinglassFetch("/api/etf/bitcoin/flow-history", apiKey),
    coinglassFetch(`/api/exchange/balance/chart?${balanceParams}`, apiKey),
  ]);

  return NextResponse.json(
    {
      configured: true,
      symbol,
      generatedAt: Date.now(),
      orderBook: normalizeOrderBook(orderBookResult),
      bitcoinEtf: base === "BTC" ? normalizeEtf(etfResult) : { available: false, reason: "Sólo aplica a BTC" },
      exchangeBalance: normalizeBalance(balanceResult),
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}

async function coinglassFetch(path: string, apiKey: string): Promise<unknown> {
  const response = await fetch(`${COINGLASS_BASE}${path}`, {
    headers: { "CG-API-KEY": apiKey, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  const payload = (await response.json()) as { code?: string | number; msg?: string; data?: unknown };
  const code = Number(payload.code ?? 0);
  if (Number.isFinite(code) && code !== 0) throw new Error(payload.msg || `CoinGlass code ${payload.code}`);
  return payload.data ?? payload;
}

function normalizeOrderBook(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") return { available: false, error: errorMessage(result.reason) };
  const rows = extractArray(result.value);
  const last = asRecord(rows.at(-1));
  if (!last) return { available: false, error: "Sin datos" };
  const bidsUsd = finiteNumber(last.bids_usd ?? last.bidsUsd);
  const asksUsd = finiteNumber(last.asks_usd ?? last.asksUsd);
  const denominator = bidsUsd + asksUsd;
  return {
    available: true,
    time: finiteNumber(last.time ?? last.timestamp) || null,
    bidsUsd,
    asksUsd,
    bidsQuantity: finiteNumber(last.bids_quantity ?? last.bidsQuantity),
    asksQuantity: finiteNumber(last.asks_quantity ?? last.asksQuantity),
    imbalancePct: denominator > 0 ? ((bidsUsd - asksUsd) / denominator) * 100 : 0,
  };
}

function normalizeEtf(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") return { available: false, error: errorMessage(result.reason) };
  const rows = extractArray(result.value);
  const last = asRecord(rows.at(-1));
  if (!last) return { available: false, error: "Sin datos" };
  return {
    available: true,
    time: finiteNumber(last.time ?? last.timestamp) || null,
    flowUsd: finiteNumber(last.flow_usd ?? last.flowUsd ?? last.net_flow_usd),
    priceUsd: finiteNumber(last.price_usd ?? last.priceUsd),
    breakdown: extractEtfBreakdown(last),
  };
}

function normalizeBalance(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") return { available: false, error: errorMessage(result.reason) };
  const data = asRecord(result.value);
  if (!data) return { available: false, error: "Sin datos" };
  const times = arrayNumbers(data.time_list ?? data.timeList);
  const priceList = arrayNumbers(data.price_list ?? data.priceList);
  const map = asRecord(data.data_map ?? data.dataMap) ?? {};
  const series = Object.entries(map).flatMap(([exchange, value]) => {
    const values = arrayNumbers(value);
    return values.length ? [{ exchange, values }] : [];
  });
  if (!series.length) return { available: false, error: "Sin balances por exchange" };

  const lastIndex = Math.max(0, times.length - 1);
  const previousIndex = Math.max(0, lastIndex - 1);
  const latestByExchange = series
    .map((item) => ({ exchange: item.exchange, balance: item.values[lastIndex] ?? item.values.at(-1) ?? 0 }))
    .filter((item) => Number.isFinite(item.balance))
    .sort((a, b) => b.balance - a.balance);
  const total = latestByExchange.reduce((sum, item) => sum + item.balance, 0);
  const previous = series.reduce((sum, item) => sum + (item.values[previousIndex] ?? item.values.at(-2) ?? 0), 0);

  return {
    available: true,
    time: times[lastIndex] ?? null,
    priceUsd: priceList[lastIndex] ?? null,
    total,
    change: total - previous,
    byExchange: latestByExchange.slice(0, 8),
  };
}

function extractEtfBreakdown(row: Record<string, unknown>) {
  const reserved = new Set(["time", "timestamp", "flow_usd", "flowUsd", "net_flow_usd", "price_usd", "priceUsd"]);
  return Object.entries(row)
    .filter(([key, value]) => !reserved.has(key) && typeof value === "number" && Number.isFinite(value))
    .map(([ticker, flowUsd]) => ({ ticker, flowUsd: Number(flowUsd) }))
    .sort((a, b) => Math.abs(b.flowUsd) - Math.abs(a.flowUsd))
    .slice(0, 5);
}

function extractArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["list", "data", "records", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function arrayNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
