import { describe, expect, it } from "vitest";
import {
  mergeCandles,
  parseBybitKlines,
  parseBybitLiveCandle,
  parseOkxKlines,
  toBybitInterval,
  toKLinePeriod,
  toOkxInstrument,
  toOkxInterval,
} from "../trading-candles";

describe("trading candles", () => {
  it("normalizes and orders Bybit klines", () => {
    expect(parseBybitKlines([
      ["2000", "11", "13", "10", "12", "5", "60"],
      ["1000", "10", "12", "9", "11", "4", "44"],
    ])).toEqual([
      { timestamp: 1000, open: 10, high: 12, low: 9, close: 11, volume: 4, turnover: 44 },
      { timestamp: 2000, open: 11, high: 13, low: 10, close: 12, volume: 5, turnover: 60 },
    ]);
  });

  it("normalizes OKX rows and Bybit live payloads", () => {
    expect(parseOkxKlines([["1000", "10", "12", "9", "11", "4", "40", "44", "1"]])[0])
      .toEqual({ timestamp: 1000, open: 10, high: 12, low: 9, close: 11, volume: 4, turnover: 44 });
    expect(parseBybitLiveCandle({ start: 2000, open: "11", high: "14", low: "10", close: "13", volume: "7", turnover: "91" }))
      .toEqual({ timestamp: 2000, open: 11, high: 14, low: 10, close: 13, volume: 7, turnover: 91 });
  });

  it("replaces the current candle and keeps the series bounded", () => {
    expect(mergeCandles(
      [{ timestamp: 1, open: 1, high: 2, low: 1, close: 1 }],
      [
        { timestamp: 1, open: 1, high: 3, low: 1, close: 2 },
        { timestamp: 2, open: 2, high: 3, low: 2, close: 3 },
      ],
      2,
    )).toEqual([
      { timestamp: 1, open: 1, high: 3, low: 1, close: 2 },
      { timestamp: 2, open: 2, high: 3, low: 2, close: 3 },
    ]);
  });

  it("maps every public interval to both providers and KLineChart", () => {
    expect(toBybitInterval("4h")).toBe("240");
    expect(toOkxInterval("1d")).toBe("1Dutc");
    expect(toKLinePeriod("15m")).toEqual({ type: "minute", span: 15 });
    expect(toOkxInstrument("BTCUSDT")).toBe("BTC-USDT-SWAP");
  });
});
