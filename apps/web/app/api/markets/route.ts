import { NextResponse } from "next/server";
import { sortSymbols } from "../../../lib/market/universe";
import type { Exchange, MarketInstrument } from "../../../lib/market/types";

export const dynamic = "force-dynamic";

const BINANCE_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const BYBIT_URL = "https://api.bybit.com/v5/market/instruments-info";
const OKX_URL = "https://www.okx.com/api/v5/public/instruments?instType=SWAP";
const MEXC_URL = "https://contract.mexc.com/api/v1/contract/detail";
const WHITEBIT_URL = "https://whitebit.com/api/v4/public/futures";
const BITUNIX_URL = "https://fapi.bitunix.com/api/v1/futures/market/trading_pairs";

export async function GET() {
  const loaders: Array<[Exchange, () => Promise<Set<string>>]> = [
    ["binance", loadBinance],
    ["bybit", loadBybit],
    ["okx", loadOkx],
    ["mexc", loadMexc],
    ["whitebit", loadWhitebit],
    ["bitunix", loadBitunix],
  ];

  const settled = await Promise.allSettled(loaders.map(([, load]) => load()));
  const bySymbol = new Map<string, Set<Exchange>>();
  const warnings: string[] = [];

  settled.forEach((result, index) => {
    const exchange = loaders[index]?.[0];
    if (!exchange) return;
    if (result.status === "rejected") {
      warnings.push(`${exchange}: ${message(result.reason)}`);
      return;
    }
    for (const symbol of result.value) {
      const exchanges = bySymbol.get(symbol) ?? new Set<Exchange>();
      exchanges.add(exchange);
      // BingX se consume por WS para símbolos estándar USDT encontrados en otras fuentes.
      exchanges.add("bingx");
      bySymbol.set(symbol, exchanges);
    }
  });

  const markets: MarketInstrument[] = sortSymbols([...bySymbol.keys()]).map((symbol) => ({
    symbol,
    baseCoin: symbol.slice(0, -4),
    quoteCoin: "USDT",
    exchanges: [...(bySymbol.get(symbol) ?? [])],
  }));

  if (!markets.length) {
    return NextResponse.json(
      { error: "No se pudo construir el universo de mercados", warnings },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { markets, warnings },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}

async function loadBinance(): Promise<Set<string>> {
  const response = await fetch(BINANCE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    symbols?: Array<{ symbol?: string; status?: string; contractType?: string; quoteAsset?: string }>;
  };
  return new Set(
    (payload.symbols ?? [])
      .filter((item) => item.status === "TRADING" && item.contractType === "PERPETUAL" && item.quoteAsset === "USDT")
      .flatMap((item) => validSymbol(item.symbol) ? [item.symbol as string] : []),
  );
}

async function loadBybit(): Promise<Set<string>> {
  const symbols = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({ category: "linear", status: "Trading", limit: "1000" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${BYBIT_URL}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      retCode?: number;
      retMsg?: string;
      result?: { list?: Array<{ symbol?: string; status?: string; contractType?: string; quoteCoin?: string }>; nextPageCursor?: string };
    };
    if (payload.retCode !== 0) throw new Error(payload.retMsg || "respuesta inválida");
    for (const item of payload.result?.list ?? []) {
      if (item.status === "Trading" && item.contractType === "LinearPerpetual" && item.quoteCoin === "USDT" && validSymbol(item.symbol)) {
        symbols.add(item.symbol as string);
      }
    }
    cursor = payload.result?.nextPageCursor ?? "";
    if (!cursor) break;
  }
  return symbols;
}

async function loadOkx(): Promise<Set<string>> {
  const response = await fetch(OKX_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    code?: string;
    msg?: string;
    data?: Array<{ instId?: string; settleCcy?: string; state?: string }>;
  };
  if (payload.code !== "0") throw new Error(payload.msg || "respuesta inválida");
  const symbols = new Set<string>();
  for (const item of payload.data ?? []) {
    if (item.state !== "live" || item.settleCcy !== "USDT" || !item.instId?.endsWith("-USDT-SWAP")) continue;
    const base = item.instId.slice(0, -"-USDT-SWAP".length).replaceAll("-", "");
    const symbol = `${base}USDT`;
    if (validSymbol(symbol)) symbols.add(symbol);
  }
  return symbols;
}

async function loadMexc(): Promise<Set<string>> {
  const response = await fetch(MEXC_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { success?: boolean; data?: Array<Record<string, unknown>> };
  if (!payload.success) throw new Error("respuesta inválida");
  const symbols = new Set<string>();
  for (const item of payload.data ?? []) {
    const state = Number(item.state);
    const symbol = typeof item.symbol === "string" ? item.symbol.replace("_", "") : "";
    if (state === 0 && symbol.endsWith("USDT") && validSymbol(symbol)) symbols.add(symbol);
  }
  return symbols;
}

async function loadWhitebit(): Promise<Set<string>> {
  const response = await fetch(WHITEBIT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    success?: boolean;
    result?: Array<{ product_type?: string; stock_currency?: string; money_currency?: string; ticker_id?: string }>;
  };
  if (!payload.success) throw new Error("respuesta inválida");
  const symbols = new Set<string>();
  for (const item of payload.result ?? []) {
    if (item.product_type !== "Perpetual" || item.money_currency !== "USDT" || !item.stock_currency) continue;
    const symbol = `${item.stock_currency}USDT`;
    if (validSymbol(symbol)) symbols.add(symbol);
  }
  return symbols;
}

async function loadBitunix(): Promise<Set<string>> {
  const response = await fetch(BITUNIX_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as {
    code?: number;
    data?: Array<{ symbol?: string; quote?: string; symbolStatus?: string }>;
  };
  if (payload.code !== undefined && payload.code !== 0) throw new Error(`código ${payload.code}`);
  const symbols = new Set<string>();
  for (const item of payload.data ?? []) {
    if (item.quote !== "USDT" || item.symbolStatus !== "OPEN" || !validSymbol(item.symbol)) continue;
    symbols.add(item.symbol as string);
  }
  return symbols;
}

function validSymbol(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{2,24}USDT$/.test(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
