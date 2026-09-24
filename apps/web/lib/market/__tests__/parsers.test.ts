import { describe, expect, it } from "vitest";
import { parseBinanceDepth, parseBinanceLiquidations } from "../adapters/binance";
import { parseBybitLiquidations, parseBybitTicker } from "../adapters/bybit";
import { parseBingxDepth } from "../adapters/bingx";
import { parseBitunixDepth } from "../adapters/bitunix";

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

  it("normalizes BingX perpetual depth snapshots", () => {
    expect(parseBingxDepth({
      dataType: "BTC-USDT@depth100@200ms",
      data: {
        T: 12,
        bids: [["100", "2"], ["99", "3"]],
        asks: [["101", "4"]],
      },
    })).toEqual({
      exchange: "bingx",
      symbol: "BTCUSDT",
      ts: 12,
      bids: [
        { price: 100, qty: 2, notional: 200 },
        { price: 99, qty: 3, notional: 297 },
      ],
      asks: [{ price: 101, qty: 4, notional: 404 }],
    });
  });

  it("accepts only documented Bitunix depth_books payloads", () => {
    expect(parseBitunixDepth(JSON.stringify({
      ch: "depth_books",
      symbol: "ETHUSDT",
      ts: 15,
      data: { b: [["100", "2"]], a: [["101", "3"]] },
    }))).toMatchObject({ ch: "depth_books", symbol: "ETHUSDT", ts: 15 });
    expect(parseBitunixDepth(JSON.stringify({ op: "ping", pong: 1 }))).toBeNull();
  });
});
