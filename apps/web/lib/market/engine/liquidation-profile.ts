import type { EstimatedLiquidationZone } from "./estimated-liquidations";

export interface LiquidationProfileBin {
  price: number;
  longExposure: number;
  shortExposure: number;
  relativeIntensity: number;
  accumulatedLong: number;
  accumulatedShort: number;
}

export function buildLiquidationProfile(
  zones: EstimatedLiquidationZone[],
  currentPrice: number,
  bucketSize = profileBucketSize(currentPrice),
): LiquidationProfileBin[] {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || bucketSize <= 0) return [];
  const buckets = new Map<number, { long: number; short: number }>();
  for (const zone of zones) {
    if (!Number.isFinite(zone.exposure) || zone.exposure <= 0) continue;
    const price = Math.round(zone.liquidationPrice / bucketSize) * bucketSize;
    const bucket = buckets.get(price) ?? { long: 0, short: 0 };
    if (zone.side === "long") bucket.long += zone.exposure;
    else bucket.short += zone.exposure;
    buckets.set(price, bucket);
  }

  const rows = [...buckets.entries()]
    .map(([price, value]) => ({ price, ...value }))
    .sort((left, right) => left.price - right.price);
  const maxExposure = Math.max(1, ...rows.map((row) => row.long + row.short));
  const totalLong = Math.max(1, rows.reduce((sum, row) => sum + row.long, 0));
  const totalShort = Math.max(1, rows.reduce((sum, row) => sum + row.short, 0));
  let shortRunning = 0;
  const shortAccumulated = rows.map((row) => {
    if (row.price >= currentPrice) shortRunning += row.short;
    return (shortRunning / totalShort) * 100;
  });
  let longRunning = 0;
  const longAccumulated = new Array<number>(rows.length).fill(0);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.price <= currentPrice) longRunning += row.long;
    longAccumulated[index] = (longRunning / totalLong) * 100;
  }

  return rows.map((row, index) => ({
    price: row.price,
    longExposure: row.long,
    shortExposure: row.short,
    relativeIntensity: ((row.long + row.short) / maxExposure) * 100,
    accumulatedLong: longAccumulated[index],
    accumulatedShort: shortAccumulated[index],
  }));
}

export function profileBucketSize(price: number): number {
  const raw = price * 0.0005;
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}
