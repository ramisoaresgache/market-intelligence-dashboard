import { MARKET_SYMBOLS, toBinanceSymbol } from "../symbols";
import type { LiquidationEvent, MarketMetrics } from "../types";
import {
  BinanceOrderBook,
  SequenceGapError,
  type BinanceDepthEvent,
  type BinanceDepthSnapshot,
} from "../engine/orderbook";
import { BrowserExchangeAdapter, type MarketEventSink } from "./base";

const WS_BASE = "wss://fstream.binance.com";
const REST_BASE = "https://fapi.binance.com";
const OPEN_INTEREST_INTERVAL_MS = 30_000;
const EXPECTED_FEEDS = MARKET_SYMBOLS.length + 1;

export class BinanceAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private readonly connectedFeeds = new Set<string>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private lastStatusAt = 0;

  constructor(emit: MarketEventSink) {
    super("binance", emit);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Opening combined public stream" });
    this.connectCombined(0);
    void this.pollOpenInterest();
  }

  override stop(): void {
    super.stop();
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.socket?.close(1000, "worker stopped");
    this.socket = null;
    this.connectedFeeds.clear();
  }

  private connectCombined(attempt: number): void {
    if (!this.active) return;
    const streams = [
      ...MARKET_SYMBOLS.map((symbol) => `${toBinanceSymbol(symbol)}@depth@100ms`),
      "!forceOrder@arr",
    ];
    const socket = new WebSocket(`${WS_BASE}/stream?streams=${streams.join("/")}`);
    const depthStates = new Map<string, DepthStreamState>(MARKET_SYMBOLS.map((symbol) => [
      symbol,
      {
        book: new BinanceOrderBook(),
        pending: [],
        ready: false,
        synchronized: false,
        snapshotLastUpdateId: null,
      },
    ]));
    let closedForGap = false;
    this.socket = socket;

    socket.onopen = () => {
      this.markFeed("liquidations", true);
      for (const symbol of MARKET_SYMBOLS) {
        const state = depthStates.get(symbol)!;
        void this.bootstrapDepth(symbol, state.book, state.pending).then(
          (result) => {
            state.snapshotLastUpdateId = result.snapshotLastUpdateId;
            state.synchronized = result.synchronized;
            state.ready = true;
            this.markFeed(`depth:${symbol}`, true);
          },
          (error: unknown) => {
            closedForGap = true;
            this.reportReconnect(error);
            socket.close(1011, "depth bootstrap failed");
          },
        );
      }
    };

    socket.onmessage = (message) => {
      try {
        const payload = parseJsonObject(message.data);
        const stream = typeof payload.stream === "string" ? payload.stream : "";
        if (stream === "!forceOrder@arr") {
          for (const liquidation of parseBinanceLiquidations(payload)) {
            this.emit({ type: "liquidation", data: liquidation });
          }
          this.touch();
          return;
        }
        const symbol = stream.split("@")[0]?.toUpperCase();
        const state = symbol ? depthStates.get(symbol) : undefined;
        if (!state) return;
        const event = parseBinanceDepth(message.data);
        if (!state.ready) {
          state.pending.push(event);
          return;
        }
        if (!state.synchronized && state.snapshotLastUpdateId !== null) {
          event.snapshotLastUpdateId = state.snapshotLastUpdateId;
        }
        if (state.book.applyDelta(event)) {
          state.synchronized = true;
          this.emit({ type: "orderbook", data: state.book.toNormalized(symbol, event.E) });
          this.touch();
        }
      } catch (error) {
        closedForGap = error instanceof SequenceGapError;
        this.reportReconnect(error);
        socket.close(1011, "invalid depth sequence");
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.connectedFeeds.clear();
      this.publishStatus(closedForGap ? "Combined stream sequence resync" : "Combined stream reconnecting");
      this.scheduleReconnect((next) => this.connectCombined(next), attempt);
    };
  }

  private async bootstrapDepth(
    symbol: string,
    book: BinanceOrderBook,
    pending: BinanceDepthEvent[],
  ): Promise<{ snapshotLastUpdateId: number; synchronized: boolean }> {
    const response = await fetch(
      `${REST_BASE}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=1000`,
      { signal: this.signal() },
    );
    if (!response.ok) throw new Error(`Binance depth snapshot HTTP ${response.status}`);
    const snapshot = (await response.json()) as BinanceDepthSnapshot;
    book.applySnapshot(snapshot);

    let synchronized = false;
    for (const event of pending.splice(0)) {
      event.snapshotLastUpdateId = snapshot.lastUpdateId;
      if (book.applyDelta(event)) {
        synchronized = true;
        this.emit({ type: "orderbook", data: book.toNormalized(symbol, event.E) });
      }
    }
    return { snapshotLastUpdateId: snapshot.lastUpdateId, synchronized };
  }

  private async pollOpenInterest(): Promise<void> {
    if (!this.active) return;
    await Promise.allSettled(
      MARKET_SYMBOLS.map(async (symbol) => {
        const response = await fetch(
          `${REST_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`,
          { signal: this.signal() },
        );
        if (!response.ok) throw new Error(`Binance open interest HTTP ${response.status}`);
        const payload = (await response.json()) as {
          openInterest: string;
          symbol: string;
          time?: number;
        };
        const metric: MarketMetrics = {
          exchange: "binance",
          symbol: payload.symbol,
          ts: payload.time ?? Date.now(),
          openInterest: Number(payload.openInterest),
        };
        this.emit({ type: "metrics", data: metric });
      }),
    );
    if (this.active) {
      this.pollTimer = setTimeout(() => void this.pollOpenInterest(), OPEN_INTEREST_INTERVAL_MS);
    }
  }

  private signal(): AbortSignal {
    const current = this.abortController;
    if (current && !current.signal.aborted) return current.signal;
    const controller = new AbortController();
    this.abortController = controller;
    return controller.signal;
  }

  private markFeed(feed: string, connected: boolean, detail?: string): void {
    if (connected) this.connectedFeeds.add(feed);
    else this.connectedFeeds.delete(feed);
    this.publishStatus(detail);
  }

  private publishStatus(detail?: string): void {
    const allConnected = this.connectedFeeds.size === EXPECTED_FEEDS;
    this.status({
      connected: allConnected,
      state: allConnected ? "live" : this.connectedFeeds.size ? "reconnecting" : "connecting",
      lastMessageAt: this.connectedFeeds.size ? Date.now() : undefined,
      detail: detail ?? `1 combined socket · ${this.connectedFeeds.size}/${EXPECTED_FEEDS} topics live`,
    });
  }

  private touch(): void {
    const now = Date.now();
    if (now - this.lastStatusAt < 1_000) return;
    this.lastStatusAt = now;
    const allConnected = this.connectedFeeds.size === EXPECTED_FEEDS;
    this.status({
      connected: allConnected,
      state: allConnected ? "live" : "reconnecting",
      lastMessageAt: now,
      detail: `1 combined socket · ${this.connectedFeeds.size}/${EXPECTED_FEEDS} topics live`,
    });
  }

  private reportReconnect(error: unknown): void {
    this.status({
      connected: false,
      state: "reconnecting",
      lastMessageAt: Date.now(),
      detail: error instanceof Error ? error.message : "Stream interrupted",
    });
  }
}

interface DepthStreamState {
  book: BinanceOrderBook;
  pending: BinanceDepthEvent[];
  ready: boolean;
  synchronized: boolean;
  snapshotLastUpdateId: number | null;
}

export function parseBinanceDepth(raw: unknown): BinanceDepthEvent {
  const payload = parseJsonObject(raw);
  const event = (isRecord(payload.data) ? payload.data : payload) as Partial<BinanceDepthEvent>;
  if (
    typeof event.E !== "number" ||
    typeof event.U !== "number" ||
    typeof event.u !== "number" ||
    !Array.isArray(event.b) ||
    !Array.isArray(event.a)
  ) {
    throw new Error("Invalid Binance depth payload");
  }
  return event as BinanceDepthEvent;
}

export function parseBinanceLiquidations(raw: unknown): LiquidationEvent[] {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  const liquidations: LiquidationEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const event = isRecord(entry.data) ? entry.data : entry;
    const order = isRecord(event.o) ? event.o : null;
    if (!order || !MARKET_SYMBOLS.includes(order.s as (typeof MARKET_SYMBOLS)[number])) continue;
    const price = Number(order.ap || order.p);
    const qty = Number(order.z || order.q);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    liquidations.push({
      exchange: "binance",
      symbol: String(order.s),
      ts: Number(order.T ?? event.E ?? Date.now()),
      side: order.S === "SELL" ? "long" : "short",
      price,
      qty,
      notional: price * qty,
      sourceQuality: "snapshot",
    });
  }
  return liquidations;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isRecord(decoded)) throw new Error("Expected a JSON object");
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
