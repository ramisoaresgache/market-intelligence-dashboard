import { describe, expect, it } from "vitest";
import { normalizeSymbol, toBinanceSymbol, toBybitSymbol } from "../symbols";

describe("symbol mapping", () => {
  it("normalizes supported symbols for each exchange", () => {
    expect(normalizeSymbol("btc-usdt")).toBe("BTCUSDT");
    expect(normalizeSymbol("eth/usdt")).toBe("ETHUSDT");
    expect(toBinanceSymbol("SOLUSDT")).toBe("solusdt");
    expect(toBybitSymbol("sol-usdt")).toBe("SOLUSDT");
  });

  it("rejects unsupported symbols", () => {
    expect(() => normalizeSymbol("DOGEUSDT")).toThrow("Unsupported symbol");
  });
});
