import { normalizeSymbol } from "../symbols";
import type { MarketMetrics, NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, optionalNumber, type MarketEventSink } from "./base";

const WS_URL = "wss://contract.mexc.com/edge";
const HEARTBEAT_MS = 15_000;

type MexcPayload = {
  channel?: string;
  symbol?: string;
  ts?: number;
  data?: Record<string, unknown>;
};

export class MexcAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly symbol: string;
  private readonly mexcSymbol: string;
  private contractSize = 0;

  constructor(emit: MarketEventSink, symbol: string) {
    super("mexc", emit);
    this.symbol = normalizeSymbol(symbol);
    this.mexcSymbol = `${this.symbol.slice(0, -4)}_USDT`;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Consultando contrato MEXC" });
    void this.bootstrap();
  }

  override stop(): void {
    super.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close(1000, "mercado cambiado");
    this.socket = null;
  }

  private async bootstrap(): Promise<void> {
    try {
      const params = new URLSearchParams({ exchange: "mexc", symbol: this.symbol });
      const response = await fetch(`/api/exchange-bootstrap?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { contractSize?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || `bootstrap HTTP ${response.status}`);
      if (!payload.contractSize || payload.contractSize <= 0) {
        throw new Error("perpetuo MEXC no disponible");
      }
      this.contractSize = payload.contractSize;
      if (this.active) this.connect(0);
    } catch (error) {
      this.status({
        connected: false,
        state: "unavailable",
        detail: error instanceof Error ? error.message : "MEXC no disponible",
      });
    }
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({ method: "sub.depth.full", param: { symbol: this.mexcSymbol, limit: 20 } }),
      );
      socket.send(JSON.stringify({ method: "sub.ticker", param: { symbol: this.mexcSymbol } }));
      this.status({
        connected: true,
        state: "live",
        lastMessageAt: Date.now(),
        detail: "MEXC público activo",
      });
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data)) as MexcPayload;
        this.handle(payload);
        this.status({
          connected: true,
          state: "live",
          lastMessageAt: Date.now(),
          detail: "MEXC público activo",
        });
      } catch (error) {
        this.status({
          connected: false,
          state: "reconnecting",
          detail: error instanceof Error ? error.message : "Mensaje MEXC inválido",
        });
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.socket === socket) this.socket = null;
      if (!this.active) return;
      this.status({ connected: false, state: "reconnecting", detail: "Reconectando MEXC" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private handle(payload: MexcPayload): void {
    if (payload.symbol && payload.symbol !== this.mexcSymbol) return;
    const channel = payload.channel ?? "";
    const data = payload.data;
    if (!data) return;

    if (channel.startsWith("push.depth")) {
      const bids = normalizeMexcLevels(data.bids, this.contractSize);
      const asks = normalizeMexcLevels(data.asks, this.contractSize);
      if (!bids.length || !asks.length) return;
      const book: NormalizedOrderBook = {
        exchange: "mexc",
        symbol: this.symbol,
        ts: payload.ts ?? Date.now(),
        bids: bids.sort((a, b) => b.price - a.price),
        asks: asks.sort((a, b) => a.price - b.price),
        sequence: optionalNumber(data.version) ?? null,
      };
      this.emit({ type: "orderbook", data: book });
      return;
    }

    if (channel === "push.ticker") {
      const metrics: MarketMetrics = {
        exchange: "mexc",
        symbol: this.symbol,
        ts: payload.ts ?? Date.now(),
      };
      const last = optionalNumber(data.lastPrice);
      const mark = optionalNumber(data.fairPrice);
      const funding = optionalNumber(data.fundingRate);
      const holdVol = optionalNumber(data.holdVol);
      if (last !== undefined) metrics.lastPrice = last;
      if (mark !== undefined) metrics.markPrice = mark;
      if (funding !== undefined) metrics.fundingRate = funding;
      if (holdVol !== undefined) {
        metrics.openInterest = holdVol;
        const price = mark ?? last;
        if (price) metrics.openInterestValue = holdVol * this.contractSize * price;
      }
      this.emit({ type: "metrics", data: metrics });
    }
  }
}

function normalizeMexcLevels(raw: unknown, contractSize: number): OrderLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!Array.isArray(value)) return [];
    const price = Number(value[0]);
    const contracts = Number(value[1]);
    const qty = contracts * contractSize;
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return [];
    return [{ price, qty, notional: price * qty }];
  });
}
