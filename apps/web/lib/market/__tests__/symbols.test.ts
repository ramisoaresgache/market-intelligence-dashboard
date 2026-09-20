import { describe, expect, it } from "vitest";
import { baseCoinFromSymbol, normalizeSymbol, toBinanceSymbol, toBybitSymbol } from "../symbols";

describe("mapeo de símbolos", () => {
  it("normaliza cualquier perpetuo USDT válido", () => {
    expect(normalizeSymbol("btc-usdt")).toBe("BTCUSDT");
    expect(normalizeSymbol("doge/usdt")).toBe("DOGEUSDT");
    expect(toBinanceSymbol("SUIUSDT")).toBe("suiusdt");
    expect(toBybitSymbol("pepe-usdt")).toBe("PEPEUSDT");
    expect(baseCoinFromSymbol("AVAXUSDT")).toBe("AVAX");
  });

  it("rechaza símbolos que no sean pares USDT válidos", () => {
    expect(() => normalizeSymbol("BTCUSD")).toThrow("Símbolo no válido");
    expect(() => normalizeSymbol("???")).toThrow("Símbolo no válido");
  });
});
