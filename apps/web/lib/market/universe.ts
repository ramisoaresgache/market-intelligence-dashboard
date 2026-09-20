import { baseCoinFromSymbol, FALLBACK_MARKET_SYMBOLS } from "./symbols";
import type { MarketInstrument } from "./types";

const BINANCE_EXCHANGE_INFO = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const BYBIT_INSTRUMENTS = "https://api.bybit.com/v5/market/instruments-info";
const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

interface BinanceExchangeInfo {
  symbols?: Array<{
    symbol?: string;
    status?: string;
    contractType?: string;
    quoteAsset?: string;
  }>;
}

interface BybitInstrumentPage {
  retCode?: number;
  result?: {
    list?: Array<{
      symbol?: string;
      status?: string;
      contractType?: string;
      quoteCoin?: string;
    }>;
    nextPageCursor?: string;
  };
}

export async function loadMarketUniverse(): Promise<MarketInstrument[]> {
  try {
    const [binanceSymbols, bybitSymbols] = await Promise.all([
      loadBinanceSymbols(),
      loadBybitSymbols(),
    ]);

    const common = [...binanceSymbols].filter((symbol) => bybitSymbols.has(symbol));
    if (common.length < 3) return fallbackUniverse();

    return sortSymbols(common).map((symbol) => ({
      symbol,
      baseCoin: baseCoinFromSymbol(symbol),
      quoteCoin: "USDT",
      exchanges: ["binance", "bybit"],
    }));
  } catch {
    return fallbackUniverse();
  }
}

export function sortSymbols(symbols: string[]): string[] {
  const priority = new Map(PRIORITY.map((symbol, index) => [symbol, index]));
  return [...new Set(symbols)].sort((left, right) => {
    const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  });
}

function fallbackUniverse(): MarketInstrument[] {
  return FALLBACK_MARKET_SYMBOLS.map((symbol) => ({
    symbol,
    baseCoin: baseCoinFromSymbol(symbol),
    quoteCoin: "USDT",
    exchanges: ["binance", "bybit"],
  }));
}

async function loadBinanceSymbols(): Promise<Set<string>> {
  const response = await fetch(BINANCE_EXCHANGE_INFO, { cache: "no-store" });
  if (!response.ok) throw new Error(`Binance exchangeInfo HTTP ${response.status}`);
  const payload = (await response.json()) as BinanceExchangeInfo;
  return new Set(
    (payload.symbols ?? [])
      .filter(
        (item) =>
          item.status === "TRADING" &&
          item.contractType === "PERPETUAL" &&
          item.quoteAsset === "USDT" &&
          typeof item.symbol === "string",
      )
      .map((item) => item.symbol as string),
  );
}

async function loadBybitSymbols(): Promise<Set<string>> {
  const symbols = new Set<string>();
  let cursor = "";

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      category: "linear",
      status: "Trading",
      limit: "1000",
    });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`${BYBIT_INSTRUMENTS}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Bybit instruments HTTP ${response.status}`);
    const payload = (await response.json()) as BybitInstrumentPage;
    if (payload.retCode !== 0) throw new Error("Bybit devolvió un error al listar mercados");

    for (const item of payload.result?.list ?? []) {
      if (
        item.status === "Trading" &&
        item.contractType === "LinearPerpetual" &&
        item.quoteCoin === "USDT" &&
        typeof item.symbol === "string"
      ) {
        symbols.add(item.symbol);
      }
    }

    cursor = payload.result?.nextPageCursor ?? "";
    if (!cursor) break;
  }

  return symbols;
}
