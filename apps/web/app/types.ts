export type SourceStatus = {
  exchange: "binance" | "bybit";
  connected: boolean;
  ts: number;
  detail: string | null;
};
export type OrderLevel = {
  price: number;
  qty: number;
  notional: number;
};

export type OrderBook = {
  exchange: "binance" | "bybit";
  symbol: string;
  ts: number;
  bids: OrderLevel[];
  asks: OrderLevel[];
  sequence: number | string | null;
  market_type: "perpetual";
};

export type MarketMetrics = {
  exchange: "binance" | "bybit";
  symbol: string;
  ts: number;
  mark_price: number | null;
  last_price: number | null;
  open_interest: number | null;
  open_interest_value: number | null;
  funding_rate: number | null;
  next_funding_time: number | null;
};

export type Liquidation = {
  exchange: "binance" | "bybit";
  symbol: string;
  ts: number;
  side: "long" | "short";
  price: number;
  qty: number;
  notional: number;
  source_quality: "all" | "snapshot";
};

export type MarketSnapshot = {
  symbol: string;
  ts: number;
  order_books: OrderBook[];
  metrics: MarketMetrics[];
  liquidations: Liquidation[];
  sources: SourceStatus[];
};

export type StreamEvent = {
  type: string;
  data: MarketSnapshot | OrderBook | MarketMetrics | Liquidation | SourceStatus;
};
