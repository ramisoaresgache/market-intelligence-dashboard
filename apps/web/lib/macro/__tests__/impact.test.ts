import { describe, expect, it } from "vitest";
import {
  classifyNewsCategory,
  classifyNewsImpact,
  classifyScenario,
  parseEconomicValue,
  scenarioOptions,
} from "../impact";

describe("macro impact", () => {
  it("parsea porcentajes y magnitudes K/M/B", () => {
    expect(parseEconomicValue("3.1%")).toBe(3.1);
    expect(parseEconomicValue("175K")).toBe(175_000);
    expect(parseEconomicValue("-2.4B")).toBe(-2_400_000_000);
  });

  it("clasifica sorpresa numérica", () => {
    expect(classifyScenario("cpi", "2.7%", "2.9%")).toBe("lower");
    expect(classifyScenario("nfp", "175K", "175K")).toBe("inline");
    expect(classifyScenario("core-pce", "3.2%", "3.0%")).toBe("higher");
  });

  it("traduce la decisión de FED a dovish/neutral/hawkish", () => {
    expect(classifyScenario("fomc", "3.75%", "4.00%")).toBe("dovish");
    expect(classifyScenario("fomc", "4.00%", "4.00%")).toBe("neutral");
    expect(classifyScenario("fomc", "4.25%", "4.00%")).toBe("hawkish");
  });

  it("invierte la lectura de desempleo en la matriz de impacto", () => {
    const options = scenarioOptions("unemployment");
    const higher = options.find((item) => item.key === "higher");
    expect(higher?.impacts.find((item) => item.asset === "BTC / crypto")?.bias).toBe("bullish");
    expect(higher?.impacts.find((item) => item.asset === "Yields")?.bias).toBe("bearish");
  });

  it("clasifica noticias macro relevantes", () => {
    expect(classifyNewsImpact("Powell signals rate path after FOMC")).toBe("high");
    expect(classifyNewsCategory("Bitcoin ETF regulation moves through SEC")).toBe("crypto");
  });
});
