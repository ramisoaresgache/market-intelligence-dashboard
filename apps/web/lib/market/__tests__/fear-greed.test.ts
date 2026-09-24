import { describe, expect, it } from "vitest";
import { parseFearGreedResponse } from "../fear-greed";

describe("fear and greed parser", () => {
  it("normalizes and translates an Alternative.me reading", () => {
    expect(parseFearGreedResponse({
      data: [{ value: "73", value_classification: "Greed", timestamp: "1", time_until_update: "60" }],
      metadata: { error: null },
    })).toEqual({
      value: 73,
      classification: "Codicia",
      updatedAt: 1_000,
      nextUpdateSeconds: 60,
      source: "Alternative.me",
    });
  });

  it("rejects malformed readings", () => {
    expect(() => parseFearGreedResponse({ data: [{ value: "150", timestamp: "1" }] })).toThrow();
  });
});
