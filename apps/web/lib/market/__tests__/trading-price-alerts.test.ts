import { describe, expect, it } from "vitest";
import { crossedThreshold } from "../../../components/charts/trading-price-alerts";

describe("price alert crossings", () => {
  it("fires only when price crosses the chosen level", () => {
    expect(crossedThreshold(99, 101, 100, "above")).toBe(true);
    expect(crossedThreshold(101, 99, 100, "below")).toBe(true);
    expect(crossedThreshold(101, 102, 100, "above")).toBe(false);
    expect(crossedThreshold(99, 98, 100, "below")).toBe(false);
  });
});
