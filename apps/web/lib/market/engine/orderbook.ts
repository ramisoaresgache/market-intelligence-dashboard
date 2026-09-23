import type { NormalizedOrderBook, OrderLevel } from "../types";

export class SequenceGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SequenceGapError";
  }
}

type RawLevels = Array<[string, string, ...string[]]>;

export class BinanceOrderBook {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private lastUpdateId: number | null = null;

  applySnapshot(snapshot: BinanceDepthSnapshot): void {
    replaceLevels(this.bids, snapshot.bids);
    replaceLevels(this.asks, snapshot.asks);
    this.lastUpdateId = snapshot.lastUpdateId;
  }

  applyDelta(event: BinanceDepthEvent): boolean {
    const previous = this.lastUpdateId;
    if (previous === null) {
      throw new SequenceGapError("Binance snapshot required before applying deltas");
    }
    if (event.u <= previous) return false;

    const isFirst = previous === event.snapshotLastUpdateId;
    if (isFirst) {
      if (!(event.U <= previous + 1 && previous + 1 <= event.u)) {
        throw new SequenceGapError("Binance snapshot does not overlap the depth stream");
      }
    } else if ((event.pu ?? previous) !== previous) {
      throw new SequenceGapError("Binance depth sequence gap");
    }

    applyLevels(this.bids, event.b);
    applyLevels(this.asks, event.a);
    pruneLevels(this.bids, true, 1_000);
    pruneLevels(this.asks, false, 1_000);
    this.lastUpdateId = event.u;
    return true;
  }

  toNormalized(symbol: string, ts: number, depth = 50): NormalizedOrderBook {
    return {
      exchange: "binance",
      symbol,
      ts,
      bids: normalLevels(this.bids, true, depth),
      asks: normalLevels(this.asks, false, depth),
      sequence: this.lastUpdateId,
    };
  }
}

export class BybitOrderBook {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private updateId: number | null = null;
  private sequence: number | null = null;

  apply(messageType: string, data: BybitDepthData): boolean {
    if (messageType === "snapshot" || data.u === 1) {
      replaceLevels(this.bids, data.b);
      replaceLevels(this.asks, data.a);
      this.updateId = data.u;
      this.sequence = data.seq;
      return true;
    }

    if (this.updateId === null) return false;
    if (data.u <= this.updateId) return false;
    if (data.u !== this.updateId + 1) {
      throw new SequenceGapError("Bybit depth sequence gap");
    }
    if (this.sequence !== null && data.seq <= this.sequence) {
      throw new SequenceGapError("Bybit cross sequence did not advance");
    }

    applyLevels(this.bids, data.b);
    applyLevels(this.asks, data.a);
    this.updateId = data.u;
    this.sequence = data.seq;
    return true;
  }

  toNormalized(symbol: string, ts: number, depth = 50): NormalizedOrderBook {
    return {
      exchange: "bybit",
      symbol,
      ts,
      bids: normalLevels(this.bids, true, depth),
      asks: normalLevels(this.asks, false, depth),
      sequence: this.sequence,
    };
  }
}

export interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: RawLevels;
  asks: RawLevels;
}

export interface BinanceDepthEvent {
  E: number;
  U: number;
  u: number;
  pu?: number;
  b: RawLevels;
  a: RawLevels;
  snapshotLastUpdateId?: number;
}

export interface BybitDepthData {
  s: string;
  b: RawLevels;
  a: RawLevels;
  u: number;
  seq: number;
}

export function applyLevels(target: Map<number, number>, levels: RawLevels): void {
  for (const [priceText, quantityText] of levels) {
    const price = Number(priceText);
    const quantity = Number(quantityText);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (quantity === 0) target.delete(price);
    else target.set(price, quantity);
  }
}

function replaceLevels(target: Map<number, number>, levels: RawLevels): void {
  target.clear();
  applyLevels(target, levels);
}

function pruneLevels(
  target: Map<number, number>,
  descending: boolean,
  limit: number,
): void {
  if (target.size <= limit + 200) return;
  const retained = [...target.entries()]
    .sort(([left], [right]) => (descending ? right - left : left - right))
    .slice(0, limit);
  target.clear();
  for (const [price, quantity] of retained) target.set(price, quantity);
}

function normalLevels(
  source: Map<number, number>,
  descending: boolean,
  depth: number,
): OrderLevel[] {
  return [...source.entries()]
    .sort(([left], [right]) => (descending ? right - left : left - right))
    .slice(0, depth)
    .map(([price, qty]) => ({ price, qty, notional: price * qty }));
}
