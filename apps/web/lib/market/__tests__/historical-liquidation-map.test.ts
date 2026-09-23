import { describe, expect, it } from "vitest";
import {
  buildHistoricalZones,
  parseBinanceKlines,
  parseBinanceOpenInterest,
} from "../use-historical-liquidation-map";

describe("historical liquidation map", () => {
  it("parses official Binance futures kline tuples", () => {
    expect(parseBinanceKlines([
      [1, "100", "105", "98", "103", "2", 2, "0", 1, "0", "0", "0"],
    ])).toEqual([{
      openTime: 1,
      open: 100,
      high: 105,
      low: 98,
      close: 103,
      closeTime: 2,
    }]);
  });

  it("parses OI history and creates zones from positive deltas", () => {
    const candles = parseBinanceKlines([
      [1, "100", "102", "99", "101", "2", 10, "0", 1, "0", "0", "0"],
      [11, "101", "104", "100", "103", "2", 20, "0", 1, "0", "0", "0"],
    ]);
    const oi = parseBinanceOpenInterest([
      { timestamp: 10, sumOpenInterestValue: "1000000" },
      { timestamp: 20, sumOpenInterestValue: "1200000" },
    ]);
    const zones = buildHistoricalZones(candles, oi);

    expect(oi).toHaveLength(2);
    expect(zones).toHaveLength(12);
    expect(zones.some((zone) => zone.side === "long")).toBe(true);
    expect(zones.some((zone) => zone.side === "short")).toBe(true);
  });
});
