import type {
  AggregatedOrderLevel,
  Exchange,
  LiquidityFrame,
  LiquidityLevel,
  NormalizedOrderBook,
} from "../types";

export type ExchangeFilter = "all" | Exchange;

export function aggregateOrderBooks(
  books: NormalizedOrderBook[],
  filter: ExchangeFilter = "all",
  bucketSize?: number,
  depth = 30,
): { bids: AggregatedOrderLevel[]; asks: AggregatedOrderLevel[]; bucketSize: number } {
  const selected = filter === "all" ? books : books.filter((book) => book.exchange === filter);
  const midpoint = midpointFromBooks(selected) ?? midpointFromBooks(books) ?? 1;
  const bucket = bucketSize && bucketSize > 0 ? bucketSize : autoBucketSize(midpoint);

  return {
    bids: aggregateSide(selected, "bids", bucket, true).slice(0, depth),
    asks: aggregateSide(selected, "asks", bucket, false).slice(0, depth),
    bucketSize: bucket,
  };
}

export function midpointFromBooks(books: NormalizedOrderBook[]): number | null {
  const bids = books.flatMap((book) => book.bids.slice(0, 1).map((level) => level.price));
  const asks = books.flatMap((book) => book.asks.slice(0, 1).map((level) => level.price));
  if (!bids.length || !asks.length) return null;
  return (Math.max(...bids) + Math.min(...asks)) / 2;
}

export function autoBucketSize(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 1;
  const target = price * 0.00035;
  const exponent = Math.floor(Math.log10(target));
  const base = 10 ** exponent;
  const scaled = target / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

export function buildLiquidityFrame(
  symbol: string,
  books: NormalizedOrderBook[],
  ts = Date.now(),
): LiquidityFrame | null {
  const midpoint = midpointFromBooks(books);
  if (midpoint === null) return null;
  const aggregated = aggregateOrderBooks(books, "all", undefined, 45);
  const levels = new Map<number, LiquidityLevel>();

  for (const bid of aggregated.bids) {
    levels.set(bid.price, {
      price: bid.price,
      bidNotional: bid.notional,
      askNotional: levels.get(bid.price)?.askNotional ?? 0,
    });
  }
  for (const ask of aggregated.asks) {
    const previous = levels.get(ask.price);
    levels.set(ask.price, {
      price: ask.price,
      bidNotional: previous?.bidNotional ?? 0,
      askNotional: ask.notional,
    });
  }

  return {
    symbol,
    ts,
    midpoint,
    bucketSize: aggregated.bucketSize,
    levels: [...levels.values()].sort((left, right) => left.price - right.price),
  };
}

function aggregateSide(
  books: NormalizedOrderBook[],
  side: "bids" | "asks",
  bucketSize: number,
  descending: boolean,
): AggregatedOrderLevel[] {
  const buckets = new Map<string, AggregatedOrderLevel>();

  for (const book of books) {
    for (const level of book[side]) {
      const rawBucket = descending
        ? Math.floor(level.price / bucketSize) * bucketSize
        : Math.ceil(level.price / bucketSize) * bucketSize;
      const price = normalizeFloat(rawBucket, bucketSize);
      const key = price.toPrecision(15);
      const current = buckets.get(key) ?? {
        price,
        qty: 0,
        notional: 0,
        exchanges: {},
      };
      current.qty += level.qty;
      current.notional += level.notional;
      current.exchanges[book.exchange] = (current.exchanges[book.exchange] ?? 0) + level.notional;
      buckets.set(key, current);
    }
  }

  return [...buckets.values()].sort((left, right) =>
    descending ? right.price - left.price : left.price - right.price,
  );
}

function normalizeFloat(value: number, bucketSize: number): number {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(bucketSize)) + 2));
  return Number(value.toFixed(decimals));
}
