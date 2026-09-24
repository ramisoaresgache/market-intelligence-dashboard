import { describe, expect, it } from "vitest";
import {
  fromBingxSymbol,
  normalizeSymbol,
  toBinanceSymbol,
  toBingxSymbol,
  toBitunixSymbol,
  toBybitSymbol,
} from "../symbols";

describe("symbol mapping", () => {
  it("normalizes supported symbols for each exchange", () => {
    expect(normalizeSymbol("btc-usdt")).toBe("BTCUSDT");
    expect(normalizeSymbol("eth/usdt")).toBe("ETHUSDT");
    expect(toBinanceSymbol("SOLUSDT")).toBe("solusdt");
    expect(toBybitSymbol("sol-usdt")).toBe("SOLUSDT");
    expect(toBingxSymbol("BTCUSDT")).toBe("BTC-USDT");
    expect(fromBingxSymbol("ETH-USDT")).toBe("ETHUSDT");
    expect(toBitunixSymbol("sol/usdt")).toBe("SOLUSDT");
    expect(normalizeSymbol("bch-usdt")).toBe("BCHUSDT");
    expect(normalizeSymbol("bnb/usdt")).toBe("BNBUSDT");
    expect(normalizeSymbol("xrpusdt")).toBe("XRPUSDT");
  });

  it("rejects unsupported symbols", () => {
    expect(() => normalizeSymbol("DOGEUSDT")).toThrow("Unsupported symbol");
  });
});
