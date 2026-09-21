import { NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const MEXC_CONTRACT_DETAIL = "https://contract.mexc.com/api/v1/contract/detail";
const WHITEBIT_FUTURES = "https://whitebit.com/api/v4/public/futures";
const BITUNIX_TICKERS = "https://fapi.bitunix.com/api/v1/futures/market/tickers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exchange = url.searchParams.get("exchange");

  let symbol: string;
  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  try {
    if (exchange === "mexc") {
      const mexcSymbol = `${symbol.slice(0, -4)}_USDT`;
      const params = new URLSearchParams({ symbol: mexcSymbol });
      const response = await fetch(`${MEXC_CONTRACT_DETAIL}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`MEXC contrato HTTP ${response.status}`);

      const payload = (await response.json()) as { success?: boolean; data?: unknown };
      const candidates = Array.isArray(payload.data) ? payload.data : [payload.data];
      const item = candidates.find((value) => isRecord(value) && value.symbol === mexcSymbol);
      const contractSize = isRecord(item) ? optionalNumber(item.contractSize) : undefined;
      const state = isRecord(item) ? optionalNumber(item.state) : undefined;

      if (!payload.success || !contractSize || contractSize <= 0 || (state !== undefined && state !== 0)) {
        return NextResponse.json({ error: "Perpetuo MEXC no disponible" }, { status: 404 });
      }

      return NextResponse.json(
        { exchange: "mexc", symbol, contractSize },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
      );
    }

    if (exchange === "bitunix") {
      const params = new URLSearchParams({ symbols: symbol });
      const response = await fetch(`${BITUNIX_TICKERS}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Bitunix ticker HTTP ${response.status}`);

      const payload = (await response.json()) as {
        code?: number;
        data?: Array<Record<string, unknown>>;
      };
      const item = payload.data?.find((entry) => entry.symbol === symbol);
      if (!item) {
        return NextResponse.json({ error: "Ticker Bitunix no disponible" }, { status: 404 });
      }

      return NextResponse.json(
        {
          exchange: "bitunix",
          symbol,
          metrics: {
            markPrice: optionalNumber(item.markPrice),
            lastPrice: optionalNumber(item.lastPrice ?? item.last),
          },
        },
        { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
      );
    }

    if (exchange === "whitebit") {
      const market = `${symbol.slice(0, -4)}_PERP`;
      const response = await fetch(WHITEBIT_FUTURES, { cache: "no-store" });
      if (!response.ok) throw new Error(`WhiteBIT futuros HTTP ${response.status}`);

      const payload = (await response.json()) as {
        success?: boolean;
        result?: Array<Record<string, unknown>>;
      };
      const item = payload.result?.find((entry) => entry.ticker_id === market);
      if (!payload.success || !item) {
        return NextResponse.json({ error: "Perpetuo WhiteBIT no disponible" }, { status: 404 });
      }

      return NextResponse.json(
        {
          exchange: "whitebit",
          symbol,
          market,
          metrics: {
            lastPrice: optionalNumber(item.last_price),
            fundingRate: optionalNumber(item.funding_rate),
            openInterest: optionalNumber(item.open_interest),
            nextFundingTime: optionalNumber(item.next_funding_rate_timestamp),
          },
        },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
      );
    }

    return NextResponse.json({ error: "Exchange no soportado" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo inicializar el exchange" },
      { status: 502 },
    );
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
