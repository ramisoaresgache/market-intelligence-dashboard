import { describe, expect, it } from "vitest";
import { aggregateOrderBooks, autoBucketSize, buildLiquidityFrame } from "../engine/aggregate";
import type { NormalizedOrderBook } from "../types";

const books: NormalizedOrderBook[] = [
  {
    exchange: "binance",
    symbol: "BTCUSDT",
    ts: 1,
    bids: [{ price: 100, qty: 2, notional: 200 }],
    asks: [{ price: 101, qty: 1, notional: 101 }],
  },
  {
    exchange: "bybit",
    symbol: "BTCUSDT",
    ts: 1,
    bids: [{ price: 100.2, qty: 1, notional: 100.2 }],
    asks: [{ price: 100.8, qty: 3, notional: 302.4 }],
  },
];

describe("libro agregado", () => {
  it("suma nocional de ambos exchanges dentro del mismo bucket", () => {
    const result = aggregateOrderBooks(books, "all", 1, 10);
    expect(result.bids[0].price).toBe(100);
    expect(result.bids[0].notional).toBeCloseTo(300.2);
    expect(result.bids[0].exchanges.binance).toBe(200);
    expect(result.bids[0].exchanges.bybit).toBeCloseTo(100.2);
  });

  it("permite filtrar por exchange", () => {
    const result = aggregateOrderBooks(books, "bybit", 1, 10);
    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].notional).toBeCloseTo(100.2);
  });

  it("crea un frame compacto para el mapa de liquidez", () => {
    const frame = buildLiquidityFrame("BTCUSDT", books, 10);
    expect(frame).not.toBeNull();
    expect(frame?.symbol).toBe("BTCUSDT");
    expect(frame?.levels.length).toBeGreaterThan(0);
  });

  it("genera buckets automáticos positivos para distintos precios", () => {
    expect(autoBucketSize(60_000)).toBeGreaterThan(0);
    expect(autoBucketSize(0.1)).toBeGreaterThan(0);
  });
});
