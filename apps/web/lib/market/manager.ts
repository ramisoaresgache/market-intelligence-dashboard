import { MARKET_SYMBOLS } from "./symbols";
import type { MarketViewState, SourceStatus, WorkerCommand, WorkerEvent } from "./types";

type Listener = () => void;

const INITIAL_SOURCES: SourceStatus[] = [
  { exchange: "binance", connected: false, state: "connecting", detail: "Waiting for worker" },
  { exchange: "bybit", connected: false, state: "connecting", detail: "Waiting for worker" },
  { exchange: "bingx", connected: false, state: "connecting", detail: "Waiting for worker" },
  { exchange: "bitunix", connected: false, state: "connecting", detail: "Waiting for worker" },
];

const INITIAL_STATE: MarketViewState = {
  symbols: [...MARKET_SYMBOLS],
  snapshots: {},
  sources: INITIAL_SOURCES,
  publishedAt: 0,
};

export class MarketConnectionManager {
  private worker: Worker | null = null;
  private readonly listeners = new Set<Listener>();
  private state = INITIAL_STATE;
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

  getServerSnapshot = (): MarketViewState => INITIAL_STATE;

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
      for (const listener of this.listeners) listener();
    };
    this.worker.onerror = (error) => {
      this.state = {
        ...this.state,
        sources: this.state.sources.map((source) => ({
          ...source,
          connected: false,
          state: "unavailable",
          detail: error.message || "Market worker failed",
        })),
      };
      for (const listener of this.listeners) listener();
    };
    const command: WorkerCommand = { type: "start" };
    this.worker.postMessage(command);
  }

  private stop(): void {
    if (!this.worker) return;
    const command: WorkerCommand = { type: "stop" };
    this.worker.postMessage(command);
    this.worker.terminate();
    this.worker = null;
    this.state = INITIAL_STATE;
  }
}

export const marketConnectionManager = new MarketConnectionManager();
