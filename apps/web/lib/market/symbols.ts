export const MARKET_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BCHUSDT",
  "BNBUSDT",
  "XRPUSDT",
] as const;

export type MarketSymbol = (typeof MARKET_SYMBOLS)[number];

const supported = new Set<string>(MARKET_SYMBOLS);

export function normalizeSymbol(symbol: string): MarketSymbol {
  const normalized = symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "");
  if (!supported.has(normalized)) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  return normalized as MarketSymbol;
}

export function toBinanceSymbol(symbol: string): string {
  return normalizeSymbol(symbol).toLowerCase();
}

export function toBybitSymbol(symbol: string): MarketSymbol {
  return normalizeSymbol(symbol);
}

export function toBingxSymbol(symbol: string): string {
  return normalizeSymbol(symbol).replace("USDT", "-USDT");
}

export function fromBingxSymbol(symbol: string): MarketSymbol {
  return normalizeSymbol(symbol);
}

export function toBitunixSymbol(symbol: string): MarketSymbol {
  return normalizeSymbol(symbol);
}
