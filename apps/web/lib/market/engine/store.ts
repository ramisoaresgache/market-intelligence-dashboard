import type {
  MarketEvent,
  MarketSnapshot,
  MarketViewState,
  SourceStatus,
} from "../types";

export class MarketStore {
  private readonly snapshots = new Map<string, MarketSnapshot>();
  private readonly statuses = new Map<string, SourceStatus>();
  private readonly symbols: string[];

  constructor(symbols: string[] = ["BTCUSDT"]) {
    this.symbols = [...symbols];
    for (const symbol of symbols) {
      this.snapshots.set(symbol, {
        symbol,
        ts: 0,
        orderBooks: [],
        metrics: [],
        liquidations: [],
      });
    }
  }

  apply(event: MarketEvent): void {
    if (event.type === "status") {
      this.statuses.set(event.data.exchange, event.data);
      return;
    }

    const snapshot = this.snapshots.get(event.data.symbol);
    if (!snapshot) return;
    snapshot.ts = Math.max(snapshot.ts, event.data.ts);

    if (event.type === "orderbook") {
      snapshot.orderBooks = upsert(snapshot.orderBooks, event.data, "exchange");
    } else if (event.type === "metrics") {
      const previous = snapshot.metrics.find(
        (item) => item.exchange === event.data.exchange,
      );
      snapshot.metrics = upsert(
        snapshot.metrics,
        { ...previous, ...event.data },
        "exchange",
      );
    } else {
      snapshot.liquidations = [...snapshot.liquidations.slice(-199), event.data];
    }
  }

  snapshot(now = Date.now()): MarketViewState {
    return {
      activeSymbol: this.symbols[0] ?? "",
      symbols: [...this.symbols],
      snapshots: Object.fromEntries(
        [...this.snapshots].map(([symbol, value]) => [
          symbol,
          {
            ...value,
            orderBooks: [...value.orderBooks],
            metrics: [...value.metrics],
            liquidations: [...value.liquidations],
          },
        ]),
      ),
      sources: [...this.statuses.values()],
      publishedAt: now,
    };
  }
}

export class CoalescedPublisher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly publish: () => void,
    private readonly intervalMs = 150,
  ) {}

  markDirty(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.publish();
    }, this.intervalMs);
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    this.publish();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
  }
}

function upsert<T, K extends keyof T>(items: T[], next: T, key: K): T[] {
  return [...items.filter((item) => item[key] !== next[key]), next];
}
