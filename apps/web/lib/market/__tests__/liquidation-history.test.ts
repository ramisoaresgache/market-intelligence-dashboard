import { describe, expect, it } from "vitest";
import {
  mergeLiquidationEvents,
  summarizeLiquidationWindows,
} from "../liquidation-history";
import type { LiquidationEvent } from "../types";

const NOW = Date.UTC(2026, 8, 21, 3, 0, 0);

function event(hoursAgo: number, side: "long" | "short", notional: number): LiquidationEvent {
  return {
    exchange: "bybit",
    symbol: "BTCUSDT",
    ts: NOW - hoursAgo * 60 * 60 * 1000,
    side,
    price: 100_000,
    qty: notional / 100_000,
    notional,
    sourceQuality: "all",
  };
}

describe("historial móvil de liquidaciones", () => {
  it("calcula 1 h, 4 h, 12 h y 24 h sin mezclar ventanas", () => {
    const summaries = summarizeLiquidationWindows(
      [
        event(0.5, "long", 10),
        event(2, "short", 20),
        event(8, "long", 30),
        event(20, "short", 40),
      ],
      NOW,
    );

    expect(summaries.find((item) => item.hours === 1)).toMatchObject({ total: 10, long: 10, short: 0 });
    expect(summaries.find((item) => item.hours === 4)).toMatchObject({ total: 30, long: 10, short: 20 });
    expect(summaries.find((item) => item.hours === 12)).toMatchObject({ total: 60, long: 40, short: 20 });
    expect(summaries.find((item) => item.hours === 24)).toMatchObject({ total: 100, long: 40, short: 60 });
  });

  it("deduplica eventos y elimina datos de más de 24 h", () => {
    const recent = event(1, "long", 25);
    const merged = mergeLiquidationEvents([recent, event(25, "short", 50)], [recent], NOW);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.notional).toBe(25);
  });
});
