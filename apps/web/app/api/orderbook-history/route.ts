import { NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const DEFAULT_COLLECTOR_URL = "https://market-intelligence-dashboard.godino290.workers.dev";
const ALLOWED_EXCHANGES = new Set([
  "all",
  "binance",
  "bybit",
  "okx",
  "mexc",
  "whitebit",
  "bingx",
  "bitunix",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  let symbol: string;

  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  const rawExchange = (url.searchParams.get("exchange") ?? "all").toLowerCase();
  const exchange = ALLOWED_EXCHANGES.has(rawExchange) ? rawExchange : "all";
  const hours = Math.min(48, Math.max(0.25, Number(url.searchParams.get("hours") ?? 4) || 4));
  const baseUrl = (process.env.LIQUIDATION_COLLECTOR_URL || DEFAULT_COLLECTOR_URL).replace(/\/$/, "");
  const params = new URLSearchParams({ symbol, exchange, hours: String(hours) });

  try {
    const upstream = await fetch(`${baseUrl}/v1/orderbook/history?${params}`, { cache: "no-store" });
    const payload = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo consultar el histórico de order book" },
      { status: 502 },
    );
  }
}

