import { describe, expect, it } from "vitest";
import { BinanceOrderBook, BybitOrderBook, SequenceGapError } from "../engine/orderbook";

describe("Binance order book", () => {
  it("applies an overlapping first event, updates levels, and removes zero quantities", () => {
    const book = new BinanceOrderBook();
    book.applySnapshot({
      lastUpdateId: 10,
      bids: [["100", "2"], ["99", "1"]],
      asks: [["101", "3"]],
    });

    expect(book.applyDelta({
      E: 1,
      U: 10,
      u: 11,
      pu: 9,
      b: [["100", "0"], ["98", "4"]],
      a: [["101", "2"]],
      snapshotLastUpdateId: 10,
    })).toBe(true);

    expect(book.toNormalized("BTCUSDT", 1)).toMatchObject({
      bids: [
        { price: 99, qty: 1, notional: 99 },
        { price: 98, qty: 4, notional: 392 },
      ],
      asks: [{ price: 101, qty: 2, notional: 202 }],
      sequence: 11,
    });
  });

  it("rejects a sequence gap", () => {
    const book = new BinanceOrderBook();
    book.applySnapshot({ lastUpdateId: 10, bids: [], asks: [] });
    book.applyDelta({
      E: 1, U: 11, u: 11, pu: 10, b: [], a: [], snapshotLastUpdateId: 10,
    });
    expect(() => book.applyDelta({
      E: 2, U: 13, u: 13, pu: 12, b: [], a: [],
    })).toThrow(SequenceGapError);
  });
});

describe("Bybit order book", () => {
  it("normalizes a snapshot and sequential delta", () => {
    const book = new BybitOrderBook();
    book.apply("snapshot", {
      s: "ETHUSDT", u: 100, seq: 200, b: [["100", "2"]], a: [["101", "3"]],
    });
    book.apply("delta", {
      s: "ETHUSDT", u: 101, seq: 201, b: [["100", "0"], ["99", "4"]], a: [],
    });
    expect(book.toNormalized("ETHUSDT", 2).bids).toEqual([
      { price: 99, qty: 4, notional: 396 },
    ]);
  });

  it("rejects update id gaps", () => {
    const book = new BybitOrderBook();
    book.apply("snapshot", { s: "BTCUSDT", u: 10, seq: 20, b: [], a: [] });
    expect(() => book.apply("delta", {
      s: "BTCUSDT", u: 12, seq: 22, b: [], a: [],
    })).toThrow(SequenceGapError);
  });
});
