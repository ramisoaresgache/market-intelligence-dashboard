import { describe, expect, it } from "vitest";
import {
  decayedExposure,
  estimateLiquidationZones,
  liquidationZoneEnd,
  type EstimatedLiquidationZone,
  type DerivativesSample,
} from "../engine/estimated-liquidations";

const base: DerivativesSample = {
  ts: 1_000,
  price: 100,
  openInterestValue: 1_000_000,
  fundingRate: 0,
  volatility: 0.01,
};

describe("estimated liquidation model", () => {
  it("creates long and short leverage zones only when open interest grows", () => {
    const zones = estimateLiquidationZones(base, {
      ...base,
      ts: 2_000,
      price: 101,
      openInterestValue: 1_100_000,
    });

    expect(zones).toHaveLength(12);
    expect(zones.filter((zone) => zone.side === "long")).toHaveLength(6);
    expect(zones.find((zone) => zone.side === "long" && zone.leverage === 10)?.liquidationPrice).toBeLessThan(101);
    expect(zones.find((zone) => zone.side === "short" && zone.leverage === 10)?.liquidationPrice).toBeGreaterThan(101);
  });

  it("does not invent new exposure when open interest is flat or falling", () => {
    expect(estimateLiquidationZones(base, { ...base, ts: 2_000 })).toEqual([]);
    expect(estimateLiquidationZones(base, {
      ...base,
      ts: 2_000,
      openInterestValue: 900_000,
    })).toEqual([]);
  });

  it("decays modeled exposure by half over one half-life", () => {
    const [zone] = estimateLiquidationZones(base, {
      ...base,
      ts: 2_000,
      openInterestValue: 1_100_000,
    });
    expect(decayedExposure(zone, zone.createdAt + 30 * 60 * 1_000)).toBeCloseTo(zone.exposure / 2);
  });

  it("stops long and short bands when a candle reaches their level", () => {
    const zone = (side: "long" | "short", liquidationPrice: number): EstimatedLiquidationZone => ({
      id: side,
      createdAt: 1_000,
      entryPrice: 100,
      liquidationPrice,
      side,
      leverage: 10,
      exposure: 1_000,
      confidence: "medium",
    });
    const candles = [
      { openTime: 1_000, closeTime: 2_000, high: 104, low: 96 },
      { openTime: 2_000, closeTime: 3_000, high: 106, low: 94 },
    ];
    expect(liquidationZoneEnd(zone("long", 95), candles, 5_000)).toBe(3_000);
    expect(liquidationZoneEnd(zone("short", 105), candles, 5_000)).toBe(3_000);
    expect(liquidationZoneEnd(zone("long", 90), candles, 5_000)).toBe(5_000);
  });
});
