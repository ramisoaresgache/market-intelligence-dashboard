import { fromBingxSymbol, MARKET_SYMBOLS, toBingxSymbol } from "../symbols";
import type { NormalizedOrderBook, OrderLevel } from "../types";
import { BrowserExchangeAdapter, type MarketEventSink } from "./base";

const WS_URL = "wss://open-api-swap.bingx.com/swap-market";

type BingxDepthPayload = {
  dataType?: string;
  data?: {
    T?: number;
    bids?: unknown;
    asks?: unknown;
  };
};

export class BingxAdapter extends BrowserExchangeAdapter {
  private socket: WebSocket | null = null;
  private lastStatusAt = 0;

  constructor(emit: MarketEventSink) {
    super("bingx", emit);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Opening public depth stream" });
    this.connect(0);
  }

  override stop(): void {
    super.stop();
    this.socket?.close(1000, "worker stopped");
    this.socket = null;
  }

  private connect(attempt: number): void {
    if (!this.active) return;
    const socket = new WebSocket(WS_URL);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      for (const symbol of MARKET_SYMBOLS) {
        const interval = symbol === "SOLUSDT" ? "500ms" : "200ms";
        socket.send(JSON.stringify({
          id: crypto.randomUUID(),
          reqType: "sub",
          dataType: `${toBingxSymbol(symbol)}@depth100@${interval}`,
        }));
      }
      this.status({ connected: false, state: "connecting", detail: "Awaiting depth snapshots" });
    };

    socket.onmessage = (message) => {
      void this.handleFrame(message.data, socket);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.status({ connected: false, state: "reconnecting", detail: "Retrying public depth stream" });
      this.scheduleReconnect((next) => this.connect(next), attempt);
    };
  }

  private async handleFrame(raw: unknown, socket: WebSocket): Promise<void> {
    try {
      const text = await decodeBingxFrame(raw);
      if (text === "Ping") {
        if (socket.readyState === WebSocket.OPEN) socket.send("Pong");
        return;
      }
      const payload = JSON.parse(text) as BingxDepthPayload;
      const book = parseBingxDepth(payload);
      if (!book) return;
      this.emit({ type: "orderbook", data: book });
      const now = Date.now();
      if (now - this.lastStatusAt >= 1_000) {
        this.lastStatusAt = now;
        this.status({ connected: true, state: "live", lastMessageAt: now, detail: "Public perpetual depth live · order book only" });
      }
    } catch (error) {
      this.status({ connected: false, state: "reconnecting", detail: error instanceof Error ? error.message : "Invalid BingX frame" });
      socket.close(1011, "invalid public depth frame");
    }
  }
}

export async function decodeBingxFrame(raw: unknown): Promise<string> {
  if (typeof raw === "string") return raw;
  const bytes = raw instanceof ArrayBuffer
    ? new Uint8Array(raw)
    : raw instanceof Blob
      ? new Uint8Array(await raw.arrayBuffer())
      : null;
  if (!bytes) throw new Error("Unsupported BingX WebSocket frame");
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function parseBingxDepth(payload: BingxDepthPayload): NormalizedOrderBook | null {
  const match = payload.dataType?.match(/^([A-Z]+-USDT)@depth/);
  if (!match || !payload.data) return null;
  const symbol = fromBingxSymbol(match[1]);
  const bids = normalizeLevels(payload.data.bids, true);
  const asks = normalizeLevels(payload.data.asks, false);
  if (!bids.length || !asks.length) return null;
  return { exchange: "bingx", symbol, ts: Number(payload.data.T ?? Date.now()), bids, asks };
}

function normalizeLevels(raw: unknown, descending: boolean): OrderLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!Array.isArray(value) || value.length < 2) return [];
    const price = Number(value[0]);
    const qty = Number(value[1]);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return [];
    return [{ price, qty, notional: price * qty }];
  }).sort((left, right) => descending ? right.price - left.price : left.price - right.price).slice(0, 100);
}
