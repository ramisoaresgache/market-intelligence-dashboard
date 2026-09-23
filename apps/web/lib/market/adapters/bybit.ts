import { BybitOrderBook, SequenceGapError, type BybitDepthData } from "../engine/orderbook";
import { MARKET_SYMBOLS } from "../symbols";
import type { LiquidationEvent, MarketMetrics } from "../types";
import {
  BrowserExchangeAdapter,
  optionalNumber,
  type MarketEventSink,
} from "./base";

const WS_URL = "wss://stream.bybit.com/v5/public/linear";
const HEARTBEAT_INTERVAL_MS = 20_000;

type BybitPayload = {
  topic?: string;
  type?: string;
  ts?: number;
  data?: unknown;
  op?: string;
  success?: boolean;
};

export class BybitAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly books = new Map<string, BybitOrderBook>();
  private lastStatusAt = 0;

  constructor(emit: MarketEventSink) {
    super("bybit", emit);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Opening public stream" });
    this.connect(0);
  }

  override stop(): void {
    super.stop();
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.socket?.close(1000, "worker stopped");
    this.socket = null;
    this.books.clear();
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      const topics = MARKET_SYMBOLS.flatMap((symbol) => [
        `orderbook.50.${symbol}`,
        `allLiquidation.${symbol}`,
        `tickers.${symbol}`,
      ]);
      socket.send(JSON.stringify({ op: "subscribe", args: topics }));
      this.status({
        connected: false,
        state: "connecting",
        detail: "Awaiting subscription acknowledgement",
      });
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: "ping" }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    socket.onmessage = (message) => {
      try {
        const payload = parseBybitPayload(message.data);
        if (payload.op === "subscribe" && payload.success !== true) {
          throw new SubscriptionError("Bybit rejected the public topic subscription");
        }
        this.handleMessage(payload);
        if (payload.op === "subscribe" || payload.topic) this.touch();
      } catch (error) {
        this.status({
          connected: false,
          state: "reconnecting",
          lastMessageAt: Date.now(),
          detail: error instanceof Error ? error.message : "Invalid stream message",
        });
        if (error instanceof SequenceGapError || error instanceof SubscriptionError) {
          socket.close(1011, "public stream resync");
        }
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.socket === socket) this.socket = null;
      this.books.clear();
      this.status({ connected: false, state: "reconnecting", detail: "Retrying public stream" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private handleMessage(payload: BybitPayload): void {
    const topic = payload.topic ?? "";
    if (topic.startsWith("orderbook.")) {
      const data = payload.data as BybitDepthData;
      if (!data || typeof data.s !== "string") return;
      const book = this.books.get(data.s) ?? new BybitOrderBook();
      this.books.set(data.s, book);
      if (book.apply(payload.type ?? "", data)) {
        this.emit({
          type: "orderbook",
          data: book.toNormalized(data.s, payload.ts ?? Date.now()),
        });
      }
    } else if (topic.startsWith("allLiquidation.")) {
      for (const liquidation of parseBybitLiquidations(payload)) {
        this.emit({ type: "liquidation", data: liquidation });
      }
    } else if (topic.startsWith("tickers.")) {
      const metrics = parseBybitTicker(payload);
      if (metrics) this.emit({ type: "metrics", data: metrics });
    }
  }

  private touch(): void {
    const now = Date.now();
    if (now - this.lastStatusAt < 1_000) return;
    this.lastStatusAt = now;
    this.status({
      connected: true,
      state: "live",
      lastMessageAt: now,
      detail: "Public linear topics acknowledged and live",
    });
  }
}

class SubscriptionError extends Error {}

export function parseBybitPayload(raw: unknown): BybitPayload {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Expected a Bybit JSON object");
  }
  return decoded as BybitPayload;
}

export function parseBybitLiquidations(payload: BybitPayload): LiquidationEvent[] {
  const data = Array.isArray(payload.data) ? payload.data : [payload.data];
  return data.flatMap((value) => {
    if (!isRecord(value) || typeof value.s !== "string") return [];
    if (!MARKET_SYMBOLS.includes(value.s as (typeof MARKET_SYMBOLS)[number])) return [];
    const price = Number(value.p);
    const qty = Number(value.v);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return [];
    return [{
      exchange: "bybit" as const,
      symbol: value.s,
      ts: Number(value.T ?? payload.ts ?? Date.now()),
      side: value.S === "Buy" ? ("long" as const) : ("short" as const),
      price,
      qty,
      notional: price * qty,
      sourceQuality: "all" as const,
    }];
  });
}

export function parseBybitTicker(payload: BybitPayload): MarketMetrics | null {
  const data = payload.data;
  if (!isRecord(data) || typeof data.symbol !== "string") return null;
  const symbol = data.symbol;
  const metrics: MarketMetrics = {
    exchange: "bybit",
    symbol,
    ts: payload.ts ?? Date.now(),
  };
  assignNumber(metrics, "markPrice", data.markPrice);
  assignNumber(metrics, "lastPrice", data.lastPrice);
  assignNumber(metrics, "openInterest", data.openInterest);
  assignNumber(metrics, "openInterestValue", data.openInterestValue);
  assignNumber(metrics, "fundingRate", data.fundingRate);
  assignNumber(metrics, "nextFundingTime", data.nextFundingTime);
  return metrics;
}

function assignNumber<K extends keyof MarketMetrics>(
  target: MarketMetrics,
  key: K,
  value: unknown,
): void {
  const parsed = optionalNumber(value);
  if (parsed !== undefined) Object.assign(target, { [key]: parsed });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
