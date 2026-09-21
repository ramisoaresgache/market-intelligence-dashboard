import { normalizeSymbol } from "../symbols";
import type { MarketMetrics, NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, optionalNumber, type MarketEventSink } from "./base";

const WS_URL = "wss://fapi.bitunix.com/public/";
const TICKER_PROXY_URL = "/api/exchange-bootstrap";
const HEARTBEAT_MS = 20_000;

type BitunixPayload = {
  ch?: string;
  symbol?: string;
  ts?: number;
  data?: Record<string, unknown>;
};

type BitunixBootstrapPayload = {
  exchange?: string;
  symbol?: string;
  metrics?: {
    markPrice?: number;
    lastPrice?: number;
  };
};

export class BitunixAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly symbol: string;

  constructor(emit: MarketEventSink, symbol: string) {
    super("bitunix", emit);
    this.symbol = normalizeSymbol(symbol);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Abriendo Bitunix" });
    void this.loadInitialTicker();
    this.connect(0);
  }

  override stop(): void {
    super.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close(1000, "mercado cambiado");
    this.socket = null;
  }

  private async loadInitialTicker(): Promise<void> {
    try {
      const params = new URLSearchParams({ exchange: "bitunix", symbol: this.symbol });
      const response = await fetch(`${TICKER_PROXY_URL}?${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as BitunixBootstrapPayload;
      const source = payload.metrics;
      if (!source) return;

      const metrics: MarketMetrics = { exchange: "bitunix", symbol: this.symbol, ts: Date.now() };
      const mark = optionalNumber(source.markPrice);
      const last = optionalNumber(source.lastPrice);
      if (mark !== undefined) metrics.markPrice = mark;
      if (last !== undefined) metrics.lastPrice = last;
      this.emit({ type: "metrics", data: metrics });
    } catch {
      // El WebSocket sigue siendo suficiente para profundidad aunque falle el bootstrap REST.
    }
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ op: "subscribe", args: [
        { symbol: this.symbol, ch: "depth_book15" },
        { symbol: this.symbol, ch: "ticker" },
      ] }));
      this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "Bitunix público activo" });
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ op: "ping", ping: Math.floor(Date.now() / 1000) }));
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as BitunixPayload;
        this.handle(payload);
        this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "Bitunix público activo" });
      } catch (error) {
        this.status({ connected: false, state: "reconnecting", detail: error instanceof Error ? error.message : "Mensaje Bitunix inválido" });
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.socket === socket) this.socket = null;
      if (!this.active) return;
      this.status({ connected: false, state: "reconnecting", detail: "Reconectando Bitunix" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private handle(payload: BitunixPayload): void {
    if (payload.symbol && payload.symbol !== this.symbol) return;
    const data = payload.data;
    if (!data) return;

    if (payload.ch === "depth_book15") {
      const bids = normalizeLevels(data.b);
      const asks = normalizeLevels(data.a);
      if (!bids.length || !asks.length) return;
      const book: NormalizedOrderBook = {
        exchange: "bitunix",
        symbol: this.symbol,
        ts: payload.ts ?? Date.now(),
        bids: bids.sort((a, b) => b.price - a.price),
        asks: asks.sort((a, b) => a.price - b.price),
      };
      this.emit({ type: "orderbook", data: book });
      return;
    }

    if (payload.ch === "ticker") {
      const last = optionalNumber(data.la);
      if (last !== undefined) {
        this.emit({ type: "metrics", data: { exchange: "bitunix", symbol: this.symbol, ts: payload.ts ?? Date.now(), lastPrice: last } });
      }
    }
  }
}

function normalizeLevels(raw: unknown): OrderLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!Array.isArray(value)) return [];
    const price = Number(value[0]);
    const qty = Number(value[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return [];
    return [{ price, qty, notional: price * qty }];
  });
}
