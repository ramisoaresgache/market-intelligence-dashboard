import { describe, expect, it } from "vitest";
import {
  candleSeriesKey,
  mergeCandles,
  parseBingxKlines,
  parseBingxLiveCandle,
  parseBybitKlines,
  parseBybitLiveCandle,
  parseOkxKlines,
  toBybitInterval,
  toBingxInstrument,
  toKLinePeriod,
  toOkxInstrument,
  toOkxInterval,
} from "../trading-candles";

describe("trading candles", () => {
  it("uses the same versioned key for the active view and cached series", () => {
    expect(candleSeriesKey("BTCUSDT", "5m")).toBe("bingx-primary:BTCUSDT:5m");
    expect(candleSeriesKey("BTCUSDT", "1h")).not.toBe(candleSeriesKey("BTCUSDT", "5m"));
  });
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

  it("normalizes BingX REST and WebSocket candles", () => {
    expect(toBingxInstrument("BTCUSDT")).toBe("BTC-USDT");
    expect(parseBingxKlines([["2000", "11", "13", "10", "12", "5", "2999", "60"]])[0])
      .toEqual({ timestamp: 2000, open: 11, high: 13, low: 10, close: 12, volume: 5, turnover: 60 });
    expect(parseBingxLiveCandle({ K: { t: "2000", o: "11", h: "13", l: "10", c: "12", v: "5" } }))
      .toEqual({ timestamp: 2000, open: 11, high: 13, low: 10, close: 12, volume: 5 });
    expect(parseBingxKlines([{ time: 3000, open: "12", high: "14", low: "11", close: "13", volume: "6" }])[0])
      .toEqual({ timestamp: 3000, open: 12, high: 14, low: 11, close: 13, volume: 6 });
    expect(parseBingxLiveCandle({ T: 3000, o: "12", h: "14", l: "11", c: "13", v: "6" }))
      .toEqual({ timestamp: 3000, open: 12, high: 14, low: 11, close: 13, volume: 6 });
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
