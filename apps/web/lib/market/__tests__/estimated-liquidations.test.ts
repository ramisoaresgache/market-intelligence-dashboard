import { describe, expect, it } from "vitest";
import {
  decayedExposure,
  estimateLiquidationZones,
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
});
