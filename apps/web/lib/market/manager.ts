import { DEFAULT_SYMBOL, normalizeSymbol } from "./symbols";
import type { MarketViewState, SourceStatus, WorkerCommand, WorkerEvent } from "./types";

type Listener = () => void;

const INITIAL_SOURCES: SourceStatus[] = [
  { exchange: "binance", connected: false, state: "connecting", detail: "Esperando motor de mercado" },
  { exchange: "bybit", connected: false, state: "connecting", detail: "Esperando motor de mercado" },
];

function initialState(symbol: string): MarketViewState {
  return {
    activeSymbol: symbol,
    symbols: [symbol],
    snapshots: {},
    sources: INITIAL_SOURCES,
    publishedAt: 0,
  };
}

const SERVER_SNAPSHOT = initialState(DEFAULT_SYMBOL);

export class MarketConnectionManager {
  private worker: Worker | null = null;
  private readonly listeners = new Set<Listener>();
  private selectedSymbol = DEFAULT_SYMBOL;
  private state = initialState(DEFAULT_SYMBOL);
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.shutdownTimer !== null) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = null;
    this.ensureStarted();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size !== 0) return;
      this.shutdownTimer = setTimeout(() => {
        this.shutdownTimer = null;
        if (this.listeners.size === 0) this.stop();
      }, 0);
    };
  };

  getSnapshot = (): MarketViewState => this.state;
  getServerSnapshot = (): MarketViewState => SERVER_SNAPSHOT;

  setSymbol(symbol: string): void {
    const normalized = normalizeSymbol(symbol);
    if (normalized === this.selectedSymbol) return;
    this.selectedSymbol = normalized;
    this.state = initialState(normalized);
    this.notify();
    if (this.worker) {
      const command: WorkerCommand = { type: "set-symbol", symbol: normalized };
      this.worker.postMessage(command);
    }
  }

  private ensureStarted(): void {
    if (this.worker || typeof window === "undefined") return;
    this.worker = new Worker(new URL("../../workers/market.worker.ts", import.meta.url), {
      type: "module",
      name: "market-engine",
    });
    this.worker.onmessage = (message: MessageEvent<WorkerEvent>) => {
      const event = message.data;
      if (event.type === "snapshot") {
        this.state = event.data;
      } else {
        this.state = {
          ...this.state,
          sources: this.state.sources.map((source) => ({
            ...source,
            connected: false,
            state: "unavailable",
            detail: event.message,
          })),
        };
      }
      this.notify();
    };
    this.worker.onerror = (error) => {
      this.state = {
        ...this.state,
        sources: this.state.sources.map((source) => ({
          ...source,
          connected: false,
          state: "unavailable",
          detail: error.message || "Falló el motor de mercado",
        })),
      };
      this.notify();
    };
    const command: WorkerCommand = { type: "start", symbol: this.selectedSymbol };
    this.worker.postMessage(command);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private stop(): void {
    if (!this.worker) return;
    const command: WorkerCommand = { type: "stop" };
    this.worker.postMessage(command);
    this.worker.terminate();
    this.worker = null;
    this.state = initialState(this.selectedSymbol);
  }
}

export const marketConnectionManager = new MarketConnectionManager();
