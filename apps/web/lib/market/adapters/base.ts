import type { Exchange, MarketEvent, SourceStatus } from "../types";

export type MarketEventSink = (event: MarketEvent) => void;

export interface MarketAdapter {
  start(): void;
  stop(): void;
}

export abstract class BrowserExchangeAdapter implements MarketAdapter {
  protected active = false;
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();

  protected constructor(
    protected readonly exchange: Exchange,
    protected readonly emit: MarketEventSink,
  ) {}

  abstract start(): void;

  stop(): void {
    this.active = false;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
  }

  protected scheduleReconnect(reconnect: (attempt: number) => void, attempt: number): void {
    if (!this.active) return;
    const delay = reconnectDelay(attempt);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (this.active) reconnect(attempt + 1);
    }, delay);
    this.retryTimers.add(timer);
  }

  protected status(status: Omit<SourceStatus, "exchange">): void {
    this.emit({ type: "status", data: { exchange: this.exchange, ...status } });
  }
}

export function reconnectDelay(attempt: number): number {
  const exponential = 500 * 2 ** Math.min(attempt, 5);
  return Math.min(15_000, exponential);
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
