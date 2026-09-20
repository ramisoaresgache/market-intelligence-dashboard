import { afterEach, describe, expect, it, vi } from "vitest";
import { CoalescedPublisher, MarketStore } from "../engine/store";

afterEach(() => vi.useRealTimers());

describe("worker coalescing", () => {
  it("publishes one UI snapshot for many raw updates in the interval", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const coalescer = new CoalescedPublisher(publish, 150);

    for (let index = 0; index < 100; index += 1) coalescer.markDirty();
    vi.advanceTimersByTime(149);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(1);

    coalescer.markDirty();
    vi.advanceTimersByTime(150);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest exchange payload while preserving liquidation events", () => {
    const store = new MarketStore();
    store.apply({
      type: "metrics",
      data: {
        exchange: "bybit",
        symbol: "BTCUSDT",
        ts: 1,
        lastPrice: 100,
        fundingRate: 0.0001,
      },
    });
    store.apply({
      type: "metrics",
      data: { exchange: "bybit", symbol: "BTCUSDT", ts: 2, lastPrice: 101 },
    });
    store.apply({
      type: "liquidation",
      data: {
        exchange: "bybit",
        symbol: "BTCUSDT",
        ts: 3,
        side: "long",
        price: 100,
        qty: 2,
        notional: 200,
        sourceQuality: "all",
      },
    });

    const snapshot = store.snapshot(4).snapshots.BTCUSDT;
    expect(snapshot.metrics).toHaveLength(1);
    expect(snapshot.metrics[0].lastPrice).toBe(101);
    expect(snapshot.metrics[0].fundingRate).toBe(0.0001);
    expect(snapshot.liquidations).toHaveLength(1);
  });
});
