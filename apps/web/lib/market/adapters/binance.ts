import { normalizeSymbol, toBinanceSymbol } from "../symbols";
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
const EXPECTED_FEEDS = 2;

export class BinanceAdapter extends BrowserExchangeAdapter {
  private readonly sockets = new Set<WebSocket>();
  private readonly connectedFeeds = new Set<string>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private readonly symbol: string;

  constructor(emit: MarketEventSink, symbol: string) {
    super("binance", emit);
    this.symbol = normalizeSymbol(symbol);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.status({ connected: false, state: "connecting", detail: "Abriendo datos públicos" });
    this.connectDepth(this.symbol, 0);
    this.connectLiquidations(0);
    void this.pollOpenInterest();
  }

  override stop(): void {
    super.stop();
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    for (const socket of this.sockets) socket.close(1000, "mercado cambiado");
    this.sockets.clear();
    this.connectedFeeds.clear();
  }

  private connectDepth(symbol: string, attempt: number): void {
    if (!this.active) return;
    const feed = `depth:${symbol}`;
    const socket = new WebSocket(
      `${WS_BASE}/public/ws/${toBinanceSymbol(symbol)}@depth@100ms`,
    );
    const book = new BinanceOrderBook();
    const pending: BinanceDepthEvent[] = [];
    let ready = false;
    let synchronized = false;
    let snapshotLastUpdateId: number | null = null;
    let closedForGap = false;
    this.sockets.add(socket);

    socket.onopen = () => {
      this.markFeed(feed, true);
      void this.bootstrapDepth(symbol, book, pending).then(
        (result) => {
          snapshotLastUpdateId = result.snapshotLastUpdateId;
          synchronized = result.synchronized;
          ready = true;
        },
        (error: unknown) => {
          closedForGap = true;
          this.reportReconnect(error);
          socket.close(1011, "falló la sincronización del libro");
        },
      );
    };

    socket.onmessage = (message) => {
      try {
        const event = parseBinanceDepth(message.data);
        if (!ready) {
          pending.push(event);
          return;
        }
        if (!synchronized && snapshotLastUpdateId !== null) {
          event.snapshotLastUpdateId = snapshotLastUpdateId;
        }
        if (book.applyDelta(event)) {
          synchronized = true;
          this.emit({ type: "orderbook", data: book.toNormalized(symbol, event.E) });
          this.touch();
        }
      } catch (error) {
        closedForGap = error instanceof SequenceGapError;
        this.reportReconnect(error);
        socket.close(1011, "secuencia de profundidad inválida");
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.sockets.delete(socket);
      this.markFeed(feed, false, closedForGap ? "Resincronizando libro" : undefined);
      this.scheduleReconnect((next) => this.connectDepth(symbol, next), attempt);
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

  private connectLiquidations(attempt: number): void {
    if (!this.active) return;
    const feed = "liquidations";
    const socket = new WebSocket(`${WS_BASE}/market/ws/!forceOrder@arr`);
    this.sockets.add(socket);

    socket.onopen = () => this.markFeed(feed, true);
    socket.onmessage = (message) => {
      for (const liquidation of parseBinanceLiquidations(message.data, this.symbol)) {
        this.emit({ type: "liquidation", data: liquidation });
      }
      this.touch();
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.sockets.delete(socket);
      this.markFeed(feed, false);
      this.scheduleReconnect((next) => this.connectLiquidations(next), attempt);
    };
  }

  private async pollOpenInterest(): Promise<void> {
    if (!this.active) return;
    try {
      const signal = this.signal();
      const [openInterestResponse, premiumResponse] = await Promise.all([
        fetch(
          `${REST_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(this.symbol)}`,
          { signal },
        ),
        fetch(
          `${REST_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(this.symbol)}`,
          { signal },
        ),
      ]);
      if (!openInterestResponse.ok) {
        throw new Error(`Binance open interest HTTP ${openInterestResponse.status}`);
      }
      if (!premiumResponse.ok) {
        throw new Error(`Binance premium index HTTP ${premiumResponse.status}`);
      }

      const openInterestPayload = (await openInterestResponse.json()) as {
        openInterest: string;
        symbol: string;
        time?: number;
      };
      const premiumPayload = (await premiumResponse.json()) as {
        markPrice?: string;
        symbol?: string;
        time?: number;
      };
      const openInterest = Number(openInterestPayload.openInterest);
      const markPrice = Number(premiumPayload.markPrice);
      const metric: MarketMetrics = {
        exchange: "binance",
        symbol: openInterestPayload.symbol,
        ts: premiumPayload.time ?? openInterestPayload.time ?? Date.now(),
        openInterest: Number.isFinite(openInterest) ? openInterest : undefined,
        markPrice: Number.isFinite(markPrice) ? markPrice : undefined,
        openInterestValue:
          Number.isFinite(openInterest) && Number.isFinite(markPrice)
            ? openInterest * markPrice
            : undefined,
      };
      this.emit({ type: "metrics", data: metric });
    } catch (error) {
      if (this.active && !(error instanceof DOMException && error.name === "AbortError")) {
        this.reportReconnect(error);
      }
    }
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
    const allConnected = this.connectedFeeds.size === EXPECTED_FEEDS;
    this.status({
      connected: allConnected,
      state: allConnected ? "live" : this.connectedFeeds.size ? "reconnecting" : "connecting",
      lastMessageAt: connected ? Date.now() : undefined,
      detail: detail ?? `${this.connectedFeeds.size}/${EXPECTED_FEEDS} canales públicos activos`,
    });
  }

  private touch(): void {
    const allConnected = this.connectedFeeds.size === EXPECTED_FEEDS;
    this.status({
      connected: allConnected,
      state: allConnected ? "live" : "reconnecting",
      lastMessageAt: Date.now(),
      detail: `${this.connectedFeeds.size}/${EXPECTED_FEEDS} canales públicos activos`,
    });
  }

  private reportReconnect(error: unknown): void {
    this.status({
      connected: false,
      state: "reconnecting",
      lastMessageAt: Date.now(),
      detail: error instanceof Error ? error.message : "Flujo interrumpido",
    });
  }
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
    throw new Error("Payload de profundidad Binance inválido");
  }
  return event as BinanceDepthEvent;
}

export function parseBinanceLiquidations(raw: unknown, symbolFilter?: string): LiquidationEvent[] {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  const liquidations: LiquidationEvent[] = [];
  const normalizedFilter = symbolFilter ? normalizeSymbol(symbolFilter) : null;

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const event = isRecord(entry.data) ? entry.data : entry;
    const order = isRecord(event.o) ? event.o : null;
    if (!order || typeof order.s !== "string") continue;
    const symbol = order.s.toUpperCase();
    if (!symbol.endsWith("USDT") || (normalizedFilter && symbol !== normalizedFilter)) continue;
    const price = Number(order.ap || order.p);
    const qty = Number(order.z || order.q);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    liquidations.push({
      exchange: "binance",
      symbol,
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
  if (!isRecord(decoded)) throw new Error("Se esperaba un objeto JSON");
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
