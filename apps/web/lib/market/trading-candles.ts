import type { KLineData, Period } from "klinecharts";

export const TRADING_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export type TradingInterval = (typeof TRADING_INTERVALS)[number];
export type CandleSource = "bybit" | "okx";
export type TradingCandle = KLineData;

const BYBIT_INTERVALS: Record<TradingInterval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

const OKX_INTERVALS: Record<TradingInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1Dutc",
};

const PERIODS: Record<TradingInterval, Period> = {
  "1m": { type: "minute", span: 1 },
  "5m": { type: "minute", span: 5 },
  "15m": { type: "minute", span: 15 },
  "1h": { type: "hour", span: 1 },
  "4h": { type: "hour", span: 4 },
  "1d": { type: "day", span: 1 },
};

export function isTradingInterval(value: string): value is TradingInterval {
  return TRADING_INTERVALS.includes(value as TradingInterval);
}

export function toBybitInterval(interval: TradingInterval): string {
  return BYBIT_INTERVALS[interval];
}

export function toOkxInterval(interval: TradingInterval): string {
  return OKX_INTERVALS[interval];
}

export function toKLinePeriod(interval: TradingInterval): Period {
  return PERIODS[interval];
}

export function toOkxInstrument(symbol: string): string {
  return `${symbol.replace(/USDT$/i, "")}-USDT-SWAP`;
}

export function parseBybitKlines(rows: unknown): TradingCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      if (!Array.isArray(row) || row.length < 7) return [];
      const candle = toCandle(row[0], row[1], row[2], row[3], row[4], row[5], row[6]);
      return candle ? [candle] : [];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function parseOkxKlines(rows: unknown): TradingCandle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      if (!Array.isArray(row) || row.length < 6) return [];
      const candle = toCandle(row[0], row[1], row[2], row[3], row[4], row[5], row[7]);
      return candle ? [candle] : [];
    })
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function parseBybitLiveCandle(value: unknown): TradingCandle | null {
  if (!isRecord(value)) return null;
  return toCandle(
    value.start ?? value.timestamp,
    value.open,
    value.high,
    value.low,
    value.close,
    value.volume,
    value.turnover,
  );
}

export function mergeCandles(
  current: TradingCandle[],
  incoming: TradingCandle[],
  limit = 2_000,
): TradingCandle[] {
  const byTimestamp = new Map(current.map((candle) => [candle.timestamp, candle]));
  for (const candle of incoming) byTimestamp.set(candle.timestamp, candle);
  return [...byTimestamp.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-limit);
}

function toCandle(
  timestampValue: unknown,
  openValue: unknown,
  highValue: unknown,
  lowValue: unknown,
  closeValue: unknown,
  volumeValue: unknown,
  turnoverValue: unknown,
): TradingCandle | null {
  const timestamp = Number(timestampValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  const volume = Number(volumeValue);
  const turnover = Number(turnoverValue);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  return {
    timestamp,
    open,
    high,
    low,
    close,
    ...(Number.isFinite(volume) ? { volume } : {}),
    ...(Number.isFinite(turnover) ? { turnover } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
