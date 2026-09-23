import { normalizeSymbol } from "../symbols";
import type { MarketMetrics, NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, optionalNumber, type MarketEventSink } from "./base";

const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
const INSTRUMENTS_URL = "https://www.okx.com/api/v5/public/instruments";
const HEARTBEAT_MS = 20_000;

type OkxPayload = {
  arg?: { channel?: string; instId?: string };
  event?: string;
  code?: string;
  msg?: string;
  data?: Array<Record<string, unknown>>;
};

export class OkxAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly symbol: string;
  private readonly instId: string;
  private contractValue = 0;
  private markPrice?: number;

  constructor(emit: MarketEventSink, symbol: string) {
    super("okx", emit);
    this.symbol = normalizeSymbol(symbol);
    this.instId = `${this.symbol.slice(0, -4)}-USDT-SWAP`;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Consultando contrato OKX" });
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
      const params = new URLSearchParams({ instType: "SWAP", instId: this.instId });
      const response = await fetch(`${INSTRUMENTS_URL}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`instrumentos HTTP ${response.status}`);
      const payload = (await response.json()) as { code?: string; msg?: string; data?: Array<Record<string, unknown>> };
      if (payload.code !== "0") throw new Error(payload.msg || "instrumento no disponible");
      const instrument = payload.data?.[0];
      const ctVal = optionalNumber(instrument?.ctVal);
      if (!ctVal || ctVal <= 0) throw new Error("valor de contrato OKX no disponible");
      this.contractValue = ctVal;
      if (this.active) this.connect(0);
    } catch (error) {
      this.status({
        connected: false,
        state: "unavailable",
        detail: error instanceof Error ? error.message : "OKX no disponible para este par",
      });
    }
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        op: "subscribe",
        args: [
          { channel: "books5", instId: this.instId },
          { channel: "mark-price", instId: this.instId },
          { channel: "open-interest", instId: this.instId },
          { channel: "funding-rate", instId: this.instId },
        ],
      }));
      this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "OKX público activo" });
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (message) => {
      if (message.data === "pong") return;
      try {
        const payload = JSON.parse(String(message.data)) as OkxPayload;
        if (payload.event === "error") throw new Error(payload.msg || `OKX ${payload.code ?? "error"}`);
        this.handle(payload);
        this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "OKX público activo" });
      } catch (error) {
        this.status({ connected: false, state: "reconnecting", detail: error instanceof Error ? error.message : "Mensaje OKX inválido" });
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.socket === socket) this.socket = null;
      if (!this.active) return;
      this.status({ connected: false, state: "reconnecting", detail: "Reconectando OKX" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private handle(payload: OkxPayload): void {
    const channel = payload.arg?.channel;
    const data = payload.data?.[0];
    if (!channel || !data) return;

    if (channel === "books5") {
      const book = this.parseBook(data);
      if (book) this.emit({ type: "orderbook", data: book });
      return;
    }

    const metrics: MarketMetrics = { exchange: "okx", symbol: this.symbol, ts: Number(data.ts ?? Date.now()) };
    if (channel === "mark-price") {
      const mark = optionalNumber(data.markPx);
      if (mark !== undefined) {
        this.markPrice = mark;
        metrics.markPrice = mark;
      }
    } else if (channel === "open-interest") {
      const oiContracts = optionalNumber(data.oi);
      const oiBase = optionalNumber(data.oiCcy);
      const oiUsd = optionalNumber(data.oiUsd);
      if (oiContracts !== undefined) metrics.openInterest = oiContracts;
      if (oiUsd !== undefined) metrics.openInterestValue = oiUsd;
      else if (oiBase !== undefined && this.markPrice) metrics.openInterestValue = oiBase * this.markPrice;
      else if (oiContracts !== undefined && this.markPrice) metrics.openInterestValue = oiContracts * this.contractValue * this.markPrice;
    } else if (channel === "funding-rate") {
      const funding = optionalNumber(data.fundingRate);
      const next = optionalNumber(data.nextFundingTime);
      if (funding !== undefined) metrics.fundingRate = funding;
      if (next !== undefined) metrics.nextFundingTime = next;
    } else {
      return;
    }
    this.emit({ type: "metrics", data: metrics });
  }

  private parseBook(data: Record<string, unknown>): NormalizedOrderBook | null {
    const bids = normalizeOkxLevels(data.bids, this.contractValue);
    const asks = normalizeOkxLevels(data.asks, this.contractValue);
    if (!bids.length || !asks.length) return null;
    return {
      exchange: "okx",
      symbol: this.symbol,
      ts: Number(data.ts ?? Date.now()),
      bids,
      asks,
      sequence: typeof data.seqId === "string" || typeof data.seqId === "number" ? data.seqId : null,
    };
  }
}

function normalizeOkxLevels(raw: unknown, contractValue: number): OrderLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!Array.isArray(value)) return [];
    const price = Number(value[0]);
    const contracts = Number(value[1]);
    const qty = contracts * contractValue;
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return [];
    return [{ price, qty, notional: price * qty }];
  });
}
