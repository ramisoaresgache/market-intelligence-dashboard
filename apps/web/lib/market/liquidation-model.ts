export type LiquidationMapExchange = "binance" | "bybit";
export type LiquidationMapSource = "aggregate" | LiquidationMapExchange;
export type LiquidationSide = "long" | "short";

export interface HistoricalCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  turnoverUsd: number;
}

export interface HistoricalOpenInterestPoint {
  ts: number;
  openInterestUsd: number;
}

export interface EstimatedLiquidationZone {
  id: string;
  exchange: LiquidationMapExchange;
  side: LiquidationSide;
  leverage: number;
  entryPrice: number;
  price: number;
  exposureUsd: number;
  startTs: number;
  endTs: number;
}

export interface LiquidationMapPayload {
  symbol: string;
  hours: number;
  requestedSource: LiquidationMapSource;
  sourcesUsed: LiquidationMapExchange[];
  generatedAt: number;
  candles: HistoricalCandle[];
  zones: EstimatedLiquidationZone[];
  warnings: string[];
}

const MAINTENANCE_MARGIN_RATE = 0.005;
const LEVERAGE_PROFILE = [
  { leverage: 5, weight: 0.04 },
  { leverage: 10, weight: 0.1 },
  { leverage: 20, weight: 0.21 },
  { leverage: 25, weight: 0.17 },
  { leverage: 50, weight: 0.27 },
  { leverage: 75, weight: 0.12 },
  { leverage: 100, weight: 0.09 },
] as const;

export function estimateLiquidationZones(
  candles: HistoricalCandle[],
  openInterest: HistoricalOpenInterestPoint[],
  exchange: LiquidationMapExchange,
): EstimatedLiquidationZone[] {
  const sortedCandles = [...candles].sort((a, b) => a.ts - b.ts);
  const sortedOi = [...openInterest].sort((a, b) => a.ts - b.ts);
  if (!sortedCandles.length || !sortedOi.length) return [];

  const lastTs = sortedCandles.at(-1)?.ts ?? Date.now();
  const zones: EstimatedLiquidationZone[] = [];

  for (let index = 0; index < sortedOi.length; index += 1) {
    const point = sortedOi[index];
    if (!point || !Number.isFinite(point.openInterestUsd) || point.openInterestUsd <= 0) continue;

    const candle = nearestCandle(sortedCandles, point.ts);
    if (!candle || candle.close <= 0) continue;

    const previousOi = sortedOi[index - 1]?.openInterestUsd ?? point.openInterestUsd;
    const positiveDelta = Math.max(0, point.openInterestUsd - previousOi);
    const turnoverContribution = Math.min(
      point.openInterestUsd * 0.0025,
      Math.max(0, candle.turnoverUsd) * 0.025,
    );
    const seedContribution = index === 0 ? point.openInterestUsd * 0.003 : 0;
    const exposureBase = positiveDelta + turnoverContribution + seedContribution;
    if (exposureBase <= 0) continue;

    const candleReturn = candle.open > 0 ? (candle.close - candle.open) / candle.open : 0;
    const directionalTilt = clamp(candleReturn * 18, -0.14, 0.14);
    const longShare = clamp(0.5 + directionalTilt, 0.36, 0.64);
    const shortShare = 1 - longShare;

    for (const profile of LEVERAGE_PROFILE) {
      const longPrice = estimatedLiquidationPrice(candle.close, profile.leverage, "long");
      const shortPrice = estimatedLiquidationPrice(candle.close, profile.leverage, "short");
      const longExposure = exposureBase * longShare * profile.weight;
      const shortExposure = exposureBase * shortShare * profile.weight;

      zones.push({
        id: `${exchange}-${point.ts}-long-${profile.leverage}`,
        exchange,
        side: "long",
        leverage: profile.leverage,
        entryPrice: candle.close,
        price: longPrice,
        exposureUsd: longExposure,
        startTs: point.ts,
        endTs: findZoneEnd(sortedCandles, point.ts, longPrice, "long", lastTs),
      });
      zones.push({
        id: `${exchange}-${point.ts}-short-${profile.leverage}`,
        exchange,
        side: "short",
        leverage: profile.leverage,
        entryPrice: candle.close,
        price: shortPrice,
        exposureUsd: shortExposure,
        startTs: point.ts,
        endTs: findZoneEnd(sortedCandles, point.ts, shortPrice, "short", lastTs),
      });
    }
  }

  return zones.filter(
    (zone) =>
      Number.isFinite(zone.price) &&
      Number.isFinite(zone.exposureUsd) &&
      zone.price > 0 &&
      zone.exposureUsd > 0,
  );
}

export function estimatedLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: LiquidationSide,
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || leverage <= 1) return entryPrice;
  const initialMargin = 1 / leverage;
  const distance = Math.max(0.001, initialMargin - MAINTENANCE_MARGIN_RATE);
  return side === "long" ? entryPrice * (1 - distance) : entryPrice * (1 + distance);
}

export function mergeCandles(series: HistoricalCandle[][]): HistoricalCandle[] {
  const byTs = new Map<number, HistoricalCandle[]>();
  for (const candles of series) {
    for (const candle of candles) {
      const bucket = byTs.get(candle.ts) ?? [];
      bucket.push(candle);
      byTs.set(candle.ts, bucket);
    }
  }

  return [...byTs.entries()]
    .sort(([left], [right]) => left - right)
    .map(([ts, candles]) => ({
      ts,
      open: average(candles.map((item) => item.open)),
      high: Math.max(...candles.map((item) => item.high)),
      low: Math.min(...candles.map((item) => item.low)),
      close: average(candles.map((item) => item.close)),
      turnoverUsd: candles.reduce((sum, item) => sum + item.turnoverUsd, 0),
    }));
}

function nearestCandle(candles: HistoricalCandle[], ts: number): HistoricalCandle | null {
  let best: HistoricalCandle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    const distance = Math.abs(candle.ts - ts);
    if (distance < bestDistance) {
      best = candle;
      bestDistance = distance;
    }
  }
  return best;
}

function findZoneEnd(
  candles: HistoricalCandle[],
  startTs: number,
  liquidationPrice: number,
  side: LiquidationSide,
  fallbackTs: number,
): number {
  for (const candle of candles) {
    if (candle.ts <= startTs) continue;
    if (side === "long" && candle.low <= liquidationPrice) return candle.ts;
    if (side === "short" && candle.high >= liquidationPrice) return candle.ts;
  }
  return fallbackTs;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
