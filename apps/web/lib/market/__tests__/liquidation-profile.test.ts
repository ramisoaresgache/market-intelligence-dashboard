import { describe, expect, it } from "vitest";
import { buildLiquidationProfile } from "../engine/liquidation-profile";
import type { EstimatedLiquidationZone } from "../engine/estimated-liquidations";

function zone(price: number, side: "long" | "short", exposure: number): EstimatedLiquidationZone {
  return { id: `${side}-${price}`, createdAt: 1, entryPrice: 100, liquidationPrice: price, side, leverage: 10, exposure, confidence: "medium" };
}

describe("liquidation profile", () => {
  it("aggregates exposure by price and builds relative cumulative curves", () => {
    const profile = buildLiquidationProfile([
      zone(90, "long", 10), zone(95, "long", 30), zone(105, "short", 20), zone(110, "short", 20),
    ], 100, 5);
    expect(profile.map((row) => row.price)).toEqual([90, 95, 105, 110]);
    expect(profile[1].relativeIntensity).toBe(100);
    expect(profile[0].accumulatedLong).toBe(100);
    expect(profile[1].accumulatedLong).toBe(75);
    expect(profile[2].accumulatedShort).toBe(50);
    expect(profile[3].accumulatedShort).toBe(100);
  });
});
