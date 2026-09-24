import { describe, expect, it } from "vitest";
import { MARKET_SESSIONS, marketSessionState, startOfUtcDay } from "../market-sessions";

function session(id: string) {
  const value = MARKET_SESSIONS.find((item) => item.id === id);
  if (!value) throw new Error(`Missing session ${id}`);
  return value;
}

describe("market sessions in UTC", () => {
  it("uses northern-hemisphere summer offsets", () => {
    const now = Date.parse("2026-07-15T14:00:00Z");
    expect(marketSessionState(now, session("tokyo")).utcHours).toBe("00:00–06:00");
    expect(marketSessionState(now, session("london")).utcHours).toBe("07:00–15:30");
    expect(marketSessionState(now, session("europe")).utcHours).toBe("07:00–15:30");
    expect(marketSessionState(now, session("new-york")).utcHours).toBe("13:30–20:00");
  });

  it("uses northern-hemisphere winter offsets", () => {
    const now = Date.parse("2026-01-15T15:00:00Z");
    expect(marketSessionState(now, session("tokyo")).utcHours).toBe("00:00–06:00");
    expect(marketSessionState(now, session("london")).utcHours).toBe("08:00–16:30");
    expect(marketSessionState(now, session("europe")).utcHours).toBe("08:00–16:30");
    expect(marketSessionState(now, session("new-york")).utcHours).toBe("14:30–21:00");
  });

  it("calculates midnight for the current UTC calendar day", () => {
    expect(startOfUtcDay(Date.parse("2026-09-23T23:30:00Z"))).toBe(Date.parse("2026-09-23T00:00:00Z"));
    expect(startOfUtcDay(Date.parse("2026-09-24T02:59:59Z"))).toBe(Date.parse("2026-09-24T00:00:00Z"));
  });
});
