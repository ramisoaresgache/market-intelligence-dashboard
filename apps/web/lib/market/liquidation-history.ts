import type { LiquidationEvent } from "./types";

export const LIQUIDATION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const LIQUIDATION_WINDOWS_HOURS = [1, 4, 12, 24] as const;

export type LiquidationWindowHours = (typeof LIQUIDATION_WINDOWS_HOURS)[number];

export interface LiquidationWindowSummary {
  hours: LiquidationWindowHours;
  total: number;
  long: number;
  short: number;
  events: number;
}

export function liquidationEventKey(event: LiquidationEvent): string {
  return [
    event.symbol,
    event.exchange,
    event.ts,
    event.side,
    event.price,
    event.qty,
  ].join(":");
}

export function mergeLiquidationEvents(
  stored: LiquidationEvent[],
  incoming: LiquidationEvent[],
  now = Date.now(),
): LiquidationEvent[] {
  const cutoff = now - LIQUIDATION_RETENTION_MS;
  const merged = new Map<string, LiquidationEvent>();

  for (const event of [...stored, ...incoming]) {
    if (event.ts < cutoff || event.ts > now + 60_000) continue;
    merged.set(liquidationEventKey(event), event);
  }

  return [...merged.values()].sort((left, right) => left.ts - right.ts);
}

export function summarizeLiquidationWindows(
  events: LiquidationEvent[],
  now = Date.now(),
): LiquidationWindowSummary[] {
  return LIQUIDATION_WINDOWS_HOURS.map((hours) => {
    const cutoff = now - hours * 60 * 60 * 1000;
    let long = 0;
    let short = 0;
    let count = 0;

    for (const event of events) {
      if (event.ts < cutoff || event.ts > now + 60_000) continue;
      count += 1;
      if (event.side === "long") long += event.notional;
      else short += event.notional;
    }

    return {
      hours,
      total: long + short,
      long,
      short,
      events: count,
    };
  });
}
