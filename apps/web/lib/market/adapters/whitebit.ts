import { normalizeSymbol } from "../symbols";
import type { MarketMetrics, NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, optionalNumber, type MarketEventSink } from "./base";

const WS_URL = "wss://api.whitebit.com/ws";
const HEARTBEAT_MS = 45_000;
const DEPTH_LIMIT = 20;

type WhitebitPayload = {
  id?: number | null;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { message?: string } | null;
};

export class WhitebitAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly symbol: string;
  private readonly market: string;
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(emit: MarketEventSink, symbol: string) {
    super("whitebit", emit);
    this.symbol = normalizeSymbol(symbol);
    this.market = `${this.symbol.slice(0, -4)}_PERP`;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Consultando futuros WhiteBIT" });
    void this.bootstrap();
  }

  override stop(): void {
    super.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close(1000, "mercado cambiado");
    this.socket = null;
    this.bids.clear();
    this.asks.clear();
  }

  private async bootstrap(): Promise<void> {
    try {
      const params = new URLSearchParams({ exchange: "whitebit", symbol: this.symbol });
      const response = await fetch(`/api/exchange-bootstrap?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        market?: string;
        metrics?: {
          lastPrice?: number;
          fundingRate?: number;
          openInterest?: number;
          nextFundingTime?: number;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || `bootstrap HTTP ${response.status}`);
      if (payload.market !== this.market) throw new Error("perpetuo WhiteBIT no disponible");

      const metrics: MarketMetrics = {
        exchange: "whitebit",
        symbol: this.symbol,
        ts: Date.now(),
      };
      if (payload.metrics?.lastPrice !== undefined) metrics.lastPrice = payload.metrics.lastPrice;
      if (payload.metrics?.fundingRate !== undefined) metrics.fundingRate = payload.metrics.fundingRate;
      if (payload.metrics?.openInterest !== undefined) metrics.openInterest = payload.metrics.openInterest;
      if (payload.metrics?.nextFundingTime !== undefined) {
        metrics.nextFundingTime = payload.metrics.nextFundingTime;
      }
      this.emit({ type: "metrics", data: metrics });

      if (this.active) this.connect(0);
    } catch (error) {
      this.status({
        connected: false,
        state: "unavailable",
        detail: error instanceof Error ? error.message : "WhiteBIT no disponible",
      });
    }
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "depth_subscribe",
          params: [this.market, DEPTH_LIMIT, "0", true],
        }),
      );
      socket.send(
        JSON.stringify({ id: 2, method: "lastprice_subscribe", params: [this.market] }),
      );
      this.status({
        connected: true,
        state: "live",
        lastMessageAt: Date.now(),
        detail: "WhiteBIT público activo",
      });
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: 0, method: "ping", params: [] }));
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as WhitebitPayload;
        if (payload.error) throw new Error(payload.error.message || "WhiteBIT rechazó la suscripción");
        this.handle(payload);
        this.status({
          connected: true,
          state: "live",
          lastMessageAt: Date.now(),
          detail: "WhiteBIT público activo",
        });
      } catch (error) {
        this.status({
          connected: false,
          state: "reconnecting",
          detail: error instanceof Error ? error.message : "Mensaje WhiteBIT inválido",
        });
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.socket === socket) this.socket = null;
      this.bids.clear();
      this.asks.clear();
      if (!this.active) return;
      this.status({ connected: false, state: "reconnecting", detail: "Reconectando WhiteBIT" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private handle(payload: WhitebitPayload): void {
    if (payload.method === "lastprice_update" && Array.isArray(payload.params)) {
      const [market, value] = payload.params;
      if (market !== this.market) return;
      const last = optionalNumber(value);
      if (last !== undefined) {
        this.emit({
          type: "metrics",
          data: { exchange: "whitebit", symbol: this.symbol, ts: Date.now(), lastPrice: last },
        });
      }
      return;
    }

    if (payload.method !== "depth_update" || !Array.isArray(payload.params)) return;
    const [snapshotFlag, rawData, market] = payload.params;
    if (market !== this.market || !isRecord(rawData)) return;
    const fullSnapshot =
      snapshotFlag === true || rawData.past_update_id === undefined || rawData.past_update_id === null;
    if (fullSnapshot) {
      this.bids.clear();
      this.asks.clear();
    }
    applyLevels(this.bids, rawData.bids);
    applyLevels(this.asks, rawData.asks);

    const bids = mapToLevels(this.bids, true).slice(0, DEPTH_LIMIT);
    const asks = mapToLevels(this.asks, false).slice(0, DEPTH_LIMIT);
    if (!bids.length || !asks.length) return;
    const book: NormalizedOrderBook = {
      exchange: "whitebit",
      symbol: this.symbol,
      ts: Math.round((optionalNumber(rawData.timestamp) ?? Date.now() / 1000) * 1000),
      bids,
      asks,
      sequence: optionalNumber(rawData.update_id) ?? null,
    };
    this.emit({ type: "orderbook", data: book });
  }
}

function applyLevels(target: Map<number, number>, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const value of raw) {
    if (!Array.isArray(value)) continue;
    const price = Number(value[0]);
    const qty = Number(value[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0) continue;
    if (qty <= 0) target.delete(price);
    else target.set(price, qty);
  }
}

function mapToLevels(levels: Map<number, number>, descending: boolean): OrderLevel[] {
  return [...levels.entries()]
    .sort(([left], [right]) => (descending ? right - left : left - right))
    .map(([price, qty]) => ({ price, qty, notional: price * qty }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
