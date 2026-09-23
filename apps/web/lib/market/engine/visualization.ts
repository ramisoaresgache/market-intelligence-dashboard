import type { NormalizedOrderBook } from "../types";

export interface ConsolidatedBook {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  crossVenueSpread: number | null;
  crossed: boolean;
  levels: DepthLevel[];
}

export interface DepthLevel {
  price: number;
  bidNotional: number;
  askNotional: number;
  exchanges: string[];
}

export function consolidateOrderBooks(
  books: NormalizedOrderBook[],
  bucketSize?: number,
): ConsolidatedBook {
  const bestBids = books.flatMap((book) => book.bids[0]?.price ?? []);
  const bestAsks = books.flatMap((book) => book.asks[0]?.price ?? []);
  const bestBid = bestBids.length ? Math.max(...bestBids) : null;
  const bestAsk = bestAsks.length ? Math.min(...bestAsks) : null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const size = bucketSize ?? (mid === null ? 1 : niceBucketSize(mid * 0.00001));
  const aggregated = new Map<number, DepthLevel>();

  for (const book of books) {
    for (const [side, levels] of [["bid", book.bids], ["ask", book.asks]] as const) {
      for (const level of levels) {
        const price = Math.round(level.price / size) * size;
        const current = aggregated.get(price) ?? {
          price,
          bidNotional: 0,
          askNotional: 0,
          exchanges: [],
        };
        if (side === "bid") current.bidNotional += level.notional;
        else current.askNotional += level.notional;
        if (!current.exchanges.includes(book.exchange)) current.exchanges.push(book.exchange);
        aggregated.set(price, current);
      }
    }
  }

  return {
    bestBid,
    bestAsk,
    mid,
    crossVenueSpread:
      bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    crossed: bestBid !== null && bestAsk !== null && bestBid > bestAsk,
    levels: [...aggregated.values()].sort((left, right) => right.price - left.price),
  };
}

export function niceBucketSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * exponent;
}

export function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(ratio * sorted.length)));
  return sorted[index];
}
