export type Exchange = "binance" | "bybit";

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

export interface MarketInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: "USDT";
  exchanges: Exchange[];
}

export interface AggregatedOrderLevel extends OrderLevel {
  exchanges: Partial<Record<Exchange, number>>;
}

export interface LiquidityLevel {
  price: number;
  bidNotional: number;
  askNotional: number;
}

export interface LiquidityFrame {
  symbol: string;
  ts: number;
  midpoint: number;
  bucketSize: number;
  levels: LiquidityLevel[];
}

export interface MarketViewState {
  activeSymbol: string;
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

export type WorkerCommand =
  | { type: "start"; symbol: string }
  | { type: "set-symbol"; symbol: string }
  | { type: "stop" };

export type WorkerEvent =
  | { type: "snapshot"; data: MarketViewState }
  | { type: "worker-error"; message: string };
