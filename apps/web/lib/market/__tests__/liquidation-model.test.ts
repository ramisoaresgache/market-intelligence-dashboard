import { describe, expect, it } from "vitest";
import {
  estimateLiquidationZones,
  estimatedLiquidationPrice,
  mergeCandles,
  type HistoricalCandle,
} from "../liquidation-model";

const candles: HistoricalCandle[] = [
  { ts: 0, open: 100, high: 101, low: 99, close: 100, turnoverUsd: 1_000_000 },
  { ts: 300_000, open: 100, high: 102, low: 99.5, close: 101, turnoverUsd: 1_200_000 },
  { ts: 600_000, open: 101, high: 103, low: 100, close: 102, turnoverUsd: 1_100_000 },
];

describe("modelo de liquidaciones estimadas", () => {
  it("ubica liquidaciones long debajo de la entrada y short encima", () => {
    expect(estimatedLiquidationPrice(100, 20, "long")).toBeLessThan(100);
    expect(estimatedLiquidationPrice(100, 20, "short")).toBeGreaterThan(100);
  });

  it("acerca el nivel de liquidación cuando aumenta el apalancamiento", () => {
    const long10 = estimatedLiquidationPrice(100, 10, "long");
    const long100 = estimatedLiquidationPrice(100, 100, "long");
    expect(Math.abs(100 - long100)).toBeLessThan(Math.abs(100 - long10));
  });

  it("genera zonas long y short usando crecimiento de interés abierto", () => {
    const zones = estimateLiquidationZones(
      candles,
      [
        { ts: 0, openInterestUsd: 10_000_000 },
        { ts: 300_000, openInterestUsd: 11_000_000 },
        { ts: 600_000, openInterestUsd: 11_500_000 },
      ],
      "bybit",
    );

    expect(zones.length).toBeGreaterThan(0);
    expect(zones.some((zone) => zone.side === "long")).toBe(true);
    expect(zones.some((zone) => zone.side === "short")).toBe(true);
    expect(zones.every((zone) => zone.exposureUsd > 0)).toBe(true);
  });

  it("no agrega exposición repetida sólo porque exista volumen si el OI no crece", () => {
    const zones = estimateLiquidationZones(
      candles,
      [
        { ts: 0, openInterestUsd: 10_000_000 },
        { ts: 300_000, openInterestUsd: 10_000_000 },
        { ts: 600_000, openInterestUsd: 10_000_000 },
      ],
      "binance",
    );

    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((zone) => zone.startTs === 0)).toBe(true);
  });

  it("fusiona velas de exchanges por timestamp", () => {
    const merged = mergeCandles([
      candles.slice(0, 1),
      [{ ts: 0, open: 102, high: 104, low: 98, close: 101, turnoverUsd: 500_000 }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.open).toBe(101);
    expect(merged[0]?.high).toBe(104);
    expect(merged[0]?.low).toBe(98);
    expect(merged[0]?.turnoverUsd).toBe(1_500_000);
  });
});
