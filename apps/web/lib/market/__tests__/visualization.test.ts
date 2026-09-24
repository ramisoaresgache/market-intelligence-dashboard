import { describe, expect, it } from "vitest";
import { consolidateOrderBooks, niceBucketSize, percentile } from "../engine/visualization";
import { filterOrderBooks } from "../use-liquidity-history";

describe("market visualization helpers", () => {
  it("labels a crossed consolidated market instead of reporting a normal spread", () => {
    const consolidated = consolidateOrderBooks([
      {
        exchange: "binance",
        symbol: "BTCUSDT",
        ts: 1,
        bids: [{ price: 101, qty: 1, notional: 101 }],
        asks: [{ price: 102, qty: 1, notional: 102 }],
      },
      {
        exchange: "bybit",
        symbol: "BTCUSDT",
        ts: 1,
        bids: [{ price: 99, qty: 1, notional: 99 }],
        asks: [{ price: 100, qty: 1, notional: 100 }],
      },
    ], 1);

    expect(consolidated).toMatchObject({
      bestBid: 101,
      bestAsk: 100,
      crossVenueSpread: -1,
      crossed: true,
    });
  });

  it("aggregates notional into shared price buckets", () => {
    const consolidated = consolidateOrderBooks([
      {
        exchange: "binance",
        symbol: "ETHUSDT",
        ts: 1,
        bids: [{ price: 100.1, qty: 2, notional: 200.2 }],
        asks: [],
      },
      {
        exchange: "bybit",
        symbol: "ETHUSDT",
        ts: 1,
        bids: [{ price: 100.2, qty: 3, notional: 300.6 }],
        asks: [],
      },
    ], 1);
    expect(consolidated.levels).toEqual([
      {
        price: 100,
        bidNotional: 500.8,
        askNotional: 0,
        exchanges: ["binance", "bybit"],
      },
    ]);
  });

  it("creates readable bucket sizes and percentiles", () => {
    expect(niceBucketSize(20.2)).toBe(50);
    expect(niceBucketSize(0.026)).toBe(0.05);
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(4);
  });

  it("filters the heatmap source without changing the consolidated option", () => {
    const books = [
      { exchange: "binance" as const, symbol: "BTCUSDT", ts: 1, bids: [], asks: [] },
      { exchange: "bingx" as const, symbol: "BTCUSDT", ts: 1, bids: [], asks: [] },
      { exchange: "bitunix" as const, symbol: "BTCUSDT", ts: 1, bids: [], asks: [] },
    ];
    expect(filterOrderBooks(books, "bingx")).toEqual([books[1]]);
    expect(filterOrderBooks(books, "all")).toBe(books);
  });
});
