export const DEFAULT_SYMBOL = "BTCUSDT";

export const FALLBACK_MARKET_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "TRXUSDT",
  "NEARUSDT",
  "SUIUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "PEPEUSDT",
] as const;

const symbolPattern = /^[A-Z0-9]{2,24}USDT$/;

export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().replaceAll("-", "").replaceAll("/", "").trim();
  if (!symbolPattern.test(normalized)) {
    throw new Error(`Símbolo no válido: ${symbol}`);
  }
  return normalized;
}

export function toBinanceSymbol(symbol: string): string {
  return normalizeSymbol(symbol).toLowerCase();
}

export function toBybitSymbol(symbol: string): string {
  return normalizeSymbol(symbol);
}

export function baseCoinFromSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  return normalized.slice(0, -4);
}
