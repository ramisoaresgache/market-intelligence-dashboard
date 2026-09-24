import { describe, expect, it } from "vitest";
import { MARKET_SESSIONS, marketSessionState } from "../market-sessions";

function session(id: string) {
  const value = MARKET_SESSIONS.find((item) => item.id === id);
  if (!value) throw new Error(`Missing session ${id}`);
  return value;
}

describe("market sessions in Argentina time", () => {
  it("uses northern-hemisphere summer offsets", () => {
    const now = Date.parse("2026-07-15T14:00:00Z");
    expect(marketSessionState(now, session("tokyo")).artHours).toBe("21:00–03:00");
    expect(marketSessionState(now, session("london")).artHours).toBe("04:00–12:30");
    expect(marketSessionState(now, session("europe")).artHours).toBe("04:00–12:30");
    expect(marketSessionState(now, session("new-york")).artHours).toBe("10:30–17:00");
  });

  it("uses northern-hemisphere winter offsets", () => {
    const now = Date.parse("2026-01-15T15:00:00Z");
    expect(marketSessionState(now, session("tokyo")).artHours).toBe("21:00–03:00");
    expect(marketSessionState(now, session("london")).artHours).toBe("05:00–13:30");
    expect(marketSessionState(now, session("europe")).artHours).toBe("05:00–13:30");
    expect(marketSessionState(now, session("new-york")).artHours).toBe("11:30–18:00");
  });
});
