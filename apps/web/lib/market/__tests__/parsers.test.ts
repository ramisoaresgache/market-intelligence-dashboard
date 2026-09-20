import { describe, expect, it } from "vitest";
import { parseBinanceDepth, parseBinanceLiquidations } from "../adapters/binance";
import { parseBybitLiquidations, parseBybitTicker } from "../adapters/bybit";

describe("exchange parsers", () => {
  it("parses Binance depth and maps liquidation position side", () => {
    expect(parseBinanceDepth(JSON.stringify({
      E: 1, U: 10, u: 11, pu: 9, b: [["100", "2"]], a: [],
    }))).toMatchObject({ u: 11, b: [["100", "2"]] });

    const [liquidation] = parseBinanceLiquidations(JSON.stringify({
      E: 4,
      o: { s: "BTCUSDT", S: "SELL", ap: "100", z: "2", T: 3 },
    }));
    expect(liquidation).toMatchObject({
      side: "long",
      notional: 200,
      sourceQuality: "snapshot",
    });
  });

  it("maps Bybit liquidation side and source coverage", () => {
    const [longLiquidation, shortLiquidation] = parseBybitLiquidations({
      ts: 5,
      data: [
        { s: "ETHUSDT", S: "Buy", p: "10", v: "3", T: 4 },
        { s: "ETHUSDT", S: "Sell", p: "11", v: "2", T: 5 },
      ],
    });
    expect(longLiquidation).toMatchObject({ side: "long", sourceQuality: "all" });
    expect(shortLiquidation).toMatchObject({ side: "short", sourceQuality: "all" });
  });

  it("normalizes Bybit ticker metrics", () => {
    expect(parseBybitTicker({
      ts: 8,
      data: {
        symbol: "SOLUSDT",
        markPrice: "145.5",
        lastPrice: "145.6",
        openInterest: "1234",
        openInterestValue: "179547",
        fundingRate: "0.0001",
        nextFundingTime: "20",
      },
    })).toEqual({
      exchange: "bybit",
      symbol: "SOLUSDT",
      ts: 8,
      markPrice: 145.5,
      lastPrice: 145.6,
      openInterest: 1234,
      openInterestValue: 179547,
      fundingRate: 0.0001,
      nextFundingTime: 20,
    });
  });

  it("does not erase unchanged Bybit ticker fields on delta payloads", () => {
    expect(parseBybitTicker({
      ts: 9,
      data: { symbol: "BTCUSDT", ask1Price: "100" },
    })).toEqual({ exchange: "bybit", symbol: "BTCUSDT", ts: 9 });
  });
});
