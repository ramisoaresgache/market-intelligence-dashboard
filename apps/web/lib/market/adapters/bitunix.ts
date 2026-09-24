import { MARKET_SYMBOLS, normalizeSymbol } from "../symbols";
import type { NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, type MarketEventSink } from "./base";

const WS_URL = "wss://fapi.bitunix.com/public/";
const HEARTBEAT_INTERVAL_MS = 20_000;

type RawLevels = Array<[string | number, string | number]>;
type BitunixDepthPayload = {
  ch?: string;
  symbol?: string;
  ts?: number;
  type?: string;
  action?: string;
  data?: { a?: RawLevels; b?: RawLevels };
};

class BitunixBook {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private initialized = false;

  apply(payload: BitunixDepthPayload): void {
    const replace = !this.initialized || payload.type === "snapshot" || payload.action === "snapshot";
    if (replace) {
      this.bids.clear();
      this.asks.clear();
    }
    applyLevels(this.bids, payload.data?.b ?? []);
    applyLevels(this.asks, payload.data?.a ?? []);
    this.initialized = true;
  }

  normalized(symbol: string, ts: number): NormalizedOrderBook {
    return {
      exchange: "bitunix",
      symbol,
      ts,
      bids: normalizedLevels(this.bids, true),
      asks: normalizedLevels(this.asks, false),
    };
  }
}

export class BitunixAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly books = new Map<string, BitunixBook>();
  private lastStatusAt = 0;

  constructor(emit: MarketEventSink) {
    super("bitunix", emit);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Opening public depth stream" });
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
      socket.send(JSON.stringify({
        op: "subscribe",
        args: MARKET_SYMBOLS.map((symbol) => ({ symbol, ch: "depth_books" })),
      }));
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: "ping", ping: Math.floor(Date.now() / 1_000) }));
        }
      }, HEARTBEAT_INTERVAL_MS);
      this.status({ connected: false, state: "connecting", detail: "Awaiting depth snapshots" });
    };
    socket.onmessage = (message) => {
      try {
        const book = this.parse(message.data);
        if (!book) return;
        this.emit({ type: "orderbook", data: book });
        const now = Date.now();
        if (now - this.lastStatusAt >= 1_000) {
          this.lastStatusAt = now;
          this.status({ connected: true, state: "live", lastMessageAt: now, detail: "Public futures depth live · order book only" });
        }
      } catch (error) {
        this.status({ connected: false, state: "reconnecting", detail: error instanceof Error ? error.message : "Invalid Bitunix frame" });
        socket.close(1011, "invalid public depth frame");
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.socket === socket) this.socket = null;
      this.books.clear();
      this.status({ connected: false, state: "reconnecting", detail: "Retrying public depth stream" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private parse(raw: unknown): NormalizedOrderBook | null {
    const payload = parseBitunixDepth(raw);
    if (!payload || !payload.symbol) return null;
    const symbol = normalizeSymbol(payload.symbol);
    const book = this.books.get(symbol) ?? new BitunixBook();
    this.books.set(symbol, book);
    book.apply(payload);
    return book.normalized(symbol, Number(payload.ts ?? Date.now()));
  }
}

export function parseBitunixDepth(raw: unknown): BitunixDepthPayload | null {
  const payload = (typeof raw === "string" ? JSON.parse(raw) : raw) as BitunixDepthPayload;
  if (!payload || typeof payload !== "object" || payload.ch !== "depth_books" || !payload.data) return null;
  if (!Array.isArray(payload.data.a) || !Array.isArray(payload.data.b) || typeof payload.symbol !== "string") return null;
  return payload;
}

function applyLevels(target: Map<number, number>, levels: RawLevels): void {
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2) continue;
    const price = Number(level[0]);
    const qty = Number(level[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    if (qty <= 0) target.delete(price);
    else target.set(price, qty);
  }
}

function normalizedLevels(source: Map<number, number>, descending: boolean): OrderLevel[] {
  return [...source].sort(([left], [right]) => descending ? right - left : left - right).slice(0, 100)
    .map(([price, qty]) => ({ price, qty, notional: price * qty }));
}
