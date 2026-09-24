import { describe, expect, it } from "vitest";
import { assessCryptoImpact, translateEconomicEvent } from "../economic-impact";

describe("economic event crypto impact", () => {
  it("treats a higher-than-forecast interest rate as a negative liquidity surprise", () => {
    expect(assessCryptoImpact({ event: "Fed Interest Rate Decision", category: "Interest Rate", actual: "5.5%", forecast: "5.25%" }).impact).toBe("negative");
  });

  it("treats softer inflation as a positive rates surprise", () => {
    expect(assessCryptoImpact({ event: "CPI YoY", category: "Inflation Rate", actual: "2.8%", forecast: "3.0%" }).impact).toBe("positive");
  });

  it("translates common releases without altering their qualifiers", () => {
    expect(translateEconomicEvent("Core PCE Price Index MoM")).toContain("Inflación PCE subyacente");
  });
});
