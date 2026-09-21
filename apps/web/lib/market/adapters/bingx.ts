import { normalizeSymbol } from "../symbols";
import type { MarketMetrics, NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, optionalNumber, type MarketEventSink } from "./base";

const WS_URL = "wss://open-api-swap.bingx.com/swap-market";

type BingxPayload = {
  dataType?: string;
  code?: number;
  msg?: string;
  data?: Record<string, unknown>;
};

export class BingxAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private readonly symbol: string;
  private readonly bingxSymbol: string;

  constructor(emit: MarketEventSink, symbol: string) {
    super("bingx", emit);
    this.symbol = normalizeSymbol(symbol);
    this.bingxSymbol = `${this.symbol.slice(0, -4)}-USDT`;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Abriendo BingX" });
    this.connect(0);
  }

  override stop(): void {
    super.stop();
    this.socket?.close(1000, "mercado cambiado");
    this.socket = null;
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      const interval = this.symbol === "BTCUSDT" || this.symbol === "ETHUSDT" ? "200ms" : "500ms";
      for (const dataType of [
        `${this.bingxSymbol}@depth20@${interval}`,
        `${this.bingxSymbol}@lastPrice`,
        `${this.bingxSymbol}@markPrice`,
      ]) {
        socket.send(JSON.stringify({ id: crypto.randomUUID(), reqType: "sub", dataType }));
      }
      this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "BingX público activo" });
    };

    socket.onmessage = (message) => {
      void this.handleRaw(message.data, socket);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.active) return;
      this.status({ connected: false, state: "reconnecting", detail: "Reconectando BingX" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private async handleRaw(raw: unknown, socket: WebSocket): Promise<void> {
    try {
      const text = await decodeBingxMessage(raw);
      if (text === "Ping" || text === "ping") {
        if (socket.readyState === WebSocket.OPEN) socket.send("Pong");
        return;
      }
      const payload = JSON.parse(text) as BingxPayload;
      if (payload.code !== undefined && payload.code !== 0) throw new Error(payload.msg || `BingX ${payload.code}`);
      this.handle(payload);
      this.status({ connected: true, state: "live", lastMessageAt: Date.now(), detail: "BingX público activo" });
    } catch (error) {
      this.status({ connected: false, state: "reconnecting", detail: error instanceof Error ? error.message : "Mensaje BingX inválido" });
    }
  }

  private handle(payload: BingxPayload): void {
    const dataType = payload.dataType ?? "";
    const data = payload.data;
    if (!data) return;

    if (dataType.includes("@depth")) {
      const bids = normalizeLevels(data.bids);
      const asks = normalizeLevels(data.asks);
      if (!bids.length || !asks.length) return;
      const book: NormalizedOrderBook = {
        exchange: "bingx",
        symbol: this.symbol,
        ts: optionalNumber(data.T) ?? Date.now(),
        bids: bids.sort((a, b) => b.price - a.price),
        asks: asks.sort((a, b) => a.price - b.price),
      };
      this.emit({ type: "orderbook", data: book });
      return;
    }

    const metrics: MarketMetrics = { exchange: "bingx", symbol: this.symbol, ts: optionalNumber(data.T) ?? Date.now() };
    if (dataType.endsWith("@lastPrice")) {
      const last = optionalNumber(data.c);
      if (last !== undefined) metrics.lastPrice = last;
      else return;
    } else if (dataType.endsWith("@markPrice")) {
      const mark = optionalNumber(data.p);
      if (mark !== undefined) metrics.markPrice = mark;
      else return;
    } else {
      return;
    }
    this.emit({ type: "metrics", data: metrics });
  }
}

async function decodeBingxMessage(raw: unknown): Promise<string> {
  if (typeof raw === "string") return raw;
  let bytes: ArrayBuffer;
  if (raw instanceof ArrayBuffer) bytes = raw;
  else if (raw instanceof Blob) bytes = await raw.arrayBuffer();
  else throw new Error("Formato binario BingX desconocido");

  if (!("DecompressionStream" in globalThis)) {
    throw new Error("El navegador no soporta descompresión GZIP para BingX");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
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
