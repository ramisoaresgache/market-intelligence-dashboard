import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";
import {
  isTradingInterval,
  parseBybitKlines,
  parseOkxKlines,
  toBybitInterval,
  toOkxInstrument,
  toOkxInterval,
  type CandleSource,
  type TradingCandle,
  type TradingInterval,
} from "../../../lib/market/trading-candles";

export const dynamic = "force-dynamic";

const BYBIT_REST = "https://api.bybit.com/v5/market/kline";
const OKX_REST = "https://www.okx.com/api/v5/market/candles";

export async function GET(request: NextRequest) {
  try {
    const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT");
    const rawInterval = request.nextUrl.searchParams.get("interval") ?? "5m";
    if (!isTradingInterval(rawInterval)) {
      return NextResponse.json({ error: "Intervalo no soportado" }, { status: 400 });
    }
    const interval = rawInterval;
    const limit = clamp(Number(request.nextUrl.searchParams.get("limit") ?? 1000), 50, 1000);
    const requestedSource = request.nextUrl.searchParams.get("source") ?? "auto";
    if (!["auto", "bybit", "okx"].includes(requestedSource)) {
      return NextResponse.json({ error: "Fuente no soportada" }, { status: 400 });
    }

    const order: CandleSource[] = requestedSource === "auto"
      ? ["bybit", "okx"]
      : [requestedSource as CandleSource];
    const warnings: string[] = [];

    for (const source of order) {
      try {
        const candles = source === "bybit"
          ? await fetchBybit(symbol, interval, limit)
          : await fetchOkx(symbol, interval, Math.min(limit, 300));
        if (!candles.length) throw new Error(`${source} no devolvió velas`);
        return NextResponse.json(
          { symbol, interval, source, generatedAt: Date.now(), candles, warnings },
          { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
        );
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `${source} no disponible`);
      }
    }

    return NextResponse.json({ error: "No se pudo obtener el histórico", warnings }, { status: 502 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Solicitud inválida" },
      { status: 400 },
    );
  }
}

async function fetchBybit(symbol: string, interval: TradingInterval, limit: number) {
  const url = new URL(BYBIT_REST);
  url.searchParams.set("category", "linear");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", toBybitInterval(interval));
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { next: { revalidate: 30 } });
  if (!response.ok) throw new Error(`Bybit HTTP ${response.status}`);
  const payload = await response.json() as { retCode?: number; retMsg?: string; result?: { list?: unknown } };
  if (payload.retCode !== 0) throw new Error(`Bybit: ${payload.retMsg ?? payload.retCode}`);
  return parseBybitKlines(payload.result?.list);
}

async function fetchOkx(symbol: string, interval: TradingInterval, limit: number) {
  const url = new URL(OKX_REST);
  url.searchParams.set("instId", toOkxInstrument(symbol));
  url.searchParams.set("bar", toOkxInterval(interval));
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { next: { revalidate: 30 } });
  if (!response.ok) throw new Error(`OKX HTTP ${response.status}`);
  const payload = await response.json() as { code?: string; msg?: string; data?: unknown };
  if (payload.code !== "0") throw new Error(`OKX: ${payload.msg ?? payload.code}`);
  return parseOkxKlines(payload.data);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
