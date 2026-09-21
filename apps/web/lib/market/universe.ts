import { baseCoinFromSymbol, FALLBACK_MARKET_SYMBOLS } from "./symbols";
import { LIVE_EXCHANGES, type MarketInstrument } from "./types";

const PRIORITY = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

interface MarketsResponse {
  markets?: MarketInstrument[];
}

export async function loadMarketUniverse(): Promise<MarketInstrument[]> {
  try {
    const response = await fetch("/api/markets", { cache: "no-store" });
    if (!response.ok) throw new Error(`mercados HTTP ${response.status}`);
    const payload = (await response.json()) as MarketsResponse;
    const markets = (payload.markets ?? []).filter(
      (market) =>
        typeof market.symbol === "string" &&
        market.quoteCoin === "USDT" &&
        Array.isArray(market.exchanges) &&
        market.exchanges.length > 0,
    );
    if (markets.length < 3) return fallbackUniverse();
    return markets;
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
    exchanges: [...LIVE_EXCHANGES],
  }));
}
