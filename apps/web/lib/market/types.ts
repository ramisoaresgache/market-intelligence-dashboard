export const MARKET_EXCHANGES = ["binance", "bybit", "bingx", "bitunix"] as const;

export type Exchange = (typeof MARKET_EXCHANGES)[number];
export type ExchangeFilter = "all" | Exchange;

export type ConnectionState = "connecting" | "live" | "reconnecting" | "unavailable";

export interface OrderLevel {
  price: number;
  qty: number;
  notional: number;
}

export interface NormalizedOrderBook {
  exchange: Exchange;
  symbol: string;
  ts: number;
  bids: OrderLevel[];
  asks: OrderLevel[];
  sequence?: string | number | null;
}

export interface LiquidationEvent {
  exchange: Exchange;
  symbol: string;
  ts: number;
  side: "long" | "short";
  price: number;
  qty: number;
  notional: number;
  sourceQuality: "all" | "snapshot" | "unknown";
}

export interface MarketMetrics {
  exchange: Exchange;
  symbol: string;
  ts: number;
  markPrice?: number;
  lastPrice?: number;
  openInterest?: number;
  openInterestValue?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}

export interface SourceStatus {
  exchange: Exchange;
  connected: boolean;
  state: ConnectionState;
  lastMessageAt?: number;
  detail?: string;
}

export interface MarketSnapshot {
  symbol: string;
  ts: number;
  orderBooks: NormalizedOrderBook[];
  metrics: MarketMetrics[];
  liquidations: LiquidationEvent[];
}

export interface MarketViewState {
  symbols: string[];
  snapshots: Record<string, MarketSnapshot>;
  sources: SourceStatus[];
  publishedAt: number;
}

export type MarketEvent =
  | { type: "orderbook"; data: NormalizedOrderBook }
  | { type: "liquidation"; data: LiquidationEvent }
  | { type: "metrics"; data: MarketMetrics }
  | { type: "status"; data: SourceStatus };

export type WorkerCommand = { type: "start" } | { type: "stop" };

export type WorkerEvent =
  | { type: "snapshot"; data: MarketViewState }
  | { type: "worker-error"; message: string };
