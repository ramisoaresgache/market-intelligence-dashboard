export interface DerivativesSample {
  ts: number;
  price: number;
  openInterestValue: number;
  fundingRate: number;
  volatility: number;
}

export interface EstimatedLiquidationZone {
  id: string;
  createdAt: number;
  entryPrice: number;
  liquidationPrice: number;
  side: "long" | "short";
  leverage: number;
  exposure: number;
  confidence: "low" | "medium";
}

const LEVERAGE_WEIGHTS = [
  { leverage: 3, weight: 0.05 },
  { leverage: 5, weight: 0.1 },
  { leverage: 10, weight: 0.22 },
  { leverage: 20, weight: 0.3 },
  { leverage: 50, weight: 0.23 },
  { leverage: 100, weight: 0.1 },
] as const;

/**
 * Converts positive session OI deltas into modeled liquidation zones.
 * These are analytical estimates, never exchange-reported open positions.
 */
export function estimateLiquidationZones(
  previous: DerivativesSample,
  current: DerivativesSample,
): EstimatedLiquidationZone[] {
  const deltaOi = current.openInterestValue - previous.openInterestValue;
  if (
    deltaOi <= 0 ||
    previous.price <= 0 ||
    current.price <= 0 ||
    !Number.isFinite(deltaOi)
  ) {
    return [];
  }

  const priceMove = (current.price - previous.price) / previous.price;
  const fundingBias = clamp(current.fundingRate * 1_000, -0.2, 0.2);
  const momentumBias = clamp(priceMove * 20, -0.18, 0.18);
  const longShare = clamp(0.5 + fundingBias + momentumBias, 0.2, 0.8);
  const maintenanceAdjustment = clamp(0.004 + current.volatility * 0.25, 0.004, 0.02);
  const confidence: EstimatedLiquidationZone["confidence"] =
    Math.abs(priceMove) > current.volatility * 0.5 ? "medium" : "low";

  return LEVERAGE_WEIGHTS.flatMap(({ leverage, weight }) => {
    const longExposure = deltaOi * longShare * weight;
    const shortExposure = deltaOi * (1 - longShare) * weight;
    return [
      {
        id: `${current.ts}-long-${leverage}`,
        createdAt: current.ts,
        entryPrice: current.price,
        liquidationPrice:
          current.price * (1 - 1 / leverage + maintenanceAdjustment),
        side: "long" as const,
        leverage,
        exposure: longExposure,
        confidence,
      },
      {
        id: `${current.ts}-short-${leverage}`,
        createdAt: current.ts,
        entryPrice: current.price,
        liquidationPrice:
          current.price * (1 + 1 / leverage - maintenanceAdjustment),
        side: "short" as const,
        leverage,
        exposure: shortExposure,
        confidence,
      },
    ];
  });
}

export function decayedExposure(
  zone: EstimatedLiquidationZone,
  now: number,
  halfLifeMs = 30 * 60 * 1_000,
): number {
  const age = Math.max(0, now - zone.createdAt);
  return zone.exposure * 0.5 ** (age / halfLifeMs);
}

export interface PriceRangeCandle {
  openTime: number;
  closeTime: number;
  high: number;
  low: number;
}

/**
 * Ends a modeled band on the candle that first reaches its liquidation level.
 * A long zone is consumed by the candle low; a short zone by the candle high.
 */
export function liquidationZoneEnd(
  zone: EstimatedLiquidationZone,
  candles: PriceRangeCandle[],
  fallbackEnd: number,
): number {
  const crossing = candles.find((candle) => candleConsumesZone(zone, candle));
  return crossing ? Math.min(fallbackEnd, Math.max(zone.createdAt, crossing.closeTime)) : fallbackEnd;
}

export function isLiquidationZoneConsumed(
  zone: EstimatedLiquidationZone,
  candles: PriceRangeCandle[],
): boolean {
  return candles.some((candle) => candleConsumesZone(zone, candle));
}

function candleConsumesZone(zone: EstimatedLiquidationZone, candle: PriceRangeCandle): boolean {
  if (candle.closeTime <= zone.createdAt) return false;
  return zone.side === "long"
    ? candle.low <= zone.liquidationPrice
    : candle.high >= zone.liquidationPrice;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
