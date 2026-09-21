import { NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const BYBIT_BASE = "https://api.bybit.com";
const OKX_BASE = "https://www.okx.com";
const DAY_MS = 24 * 60 * 60 * 1000;

type Point = { ts: number; price: number };

export async function GET(request: Request) {
  const url = new URL(request.url);
  let symbol: string;
  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  const end = Date.now();
  const start = end - DAY_MS;
  const warnings: string[] = [];
  let source = "bybit";
  let points: Point[] = [];

  try {
    points = await fetchBybit(symbol, start, end);
  } catch (error) {
    warnings.push(`Bybit: ${errorMessage(error)}`);
  }

  if (points.length < 2) {
    source = "okx";
    try {
      points = await fetchOkx(symbol, start, end);
    } catch (error) {
      warnings.push(`OKX: ${errorMessage(error)}`);
    }
  }

  if (points.length < 2) {
    return NextResponse.json({ error: "No hay histórico diario suficiente", warnings }, { status: 502 });
  }

  const open = points[0]?.price ?? 0;
  const close = points.at(-1)?.price ?? open;
  const changeUsd = close - open;
  const changePct = open > 0 ? (changeUsd / open) * 100 : 0;

  return NextResponse.json(
    {
      symbol,
      generatedAt: Date.now(),
      source,
      open,
      close,
      changeUsd,
      changePct,
      points,
      warnings,
    },
    { headers: { "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90" } },
  );
}

async function fetchBybit(symbol: string, start: number, end: number): Promise<Point[]> {
  const params = new URLSearchParams({
    category: "linear",
    symbol,
    interval: "15",
    start: String(start),
    end: String(end),
    limit: "120",
  });
  const response = await fetch(`${BYBIT_BASE}/v5/market/kline?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: string[][] };
  };
  if (payload.retCode !== 0) throw new Error(payload.retMsg || "respuesta inválida");

  return (payload.result?.list ?? [])
    .map((row) => ({ ts: Number(row[0]), price: Number(row[4]) }))
    .filter(validPoint)
    .filter((point) => point.ts >= start && point.ts <= end)
    .sort((a, b) => a.ts - b.ts);
}

async function fetchOkx(symbol: string, start: number, end: number): Promise<Point[]> {
  const instId = `${symbol.slice(0, -4)}-USDT-SWAP`;
  const params = new URLSearchParams({ instId, bar: "15m", limit: "120" });
  const response = await fetch(`${OKX_BASE}/api/v5/market/candles?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { code?: string; msg?: string; data?: string[][] };
  if (payload.code !== "0") throw new Error(payload.msg || "respuesta inválida");

  return (payload.data ?? [])
    .map((row) => ({ ts: Number(row[0]), price: Number(row[4]) }))
    .filter(validPoint)
    .filter((point) => point.ts >= start && point.ts <= end)
    .sort((a, b) => a.ts - b.ts);
}

function validPoint(point: Point): boolean {
  return Number.isFinite(point.ts) && Number.isFinite(point.price) && point.price > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
