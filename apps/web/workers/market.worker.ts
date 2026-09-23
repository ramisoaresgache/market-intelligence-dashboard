/// <reference lib="webworker" />

import { BinanceAdapter } from "../lib/market/adapters/binance";
import { BingxAdapter } from "../lib/market/adapters/bingx";
import { BitunixAdapter } from "../lib/market/adapters/bitunix";
import { BybitAdapter } from "../lib/market/adapters/bybit";
import { MexcAdapter } from "../lib/market/adapters/mexc";
import { OkxAdapter } from "../lib/market/adapters/okx";
import { WhitebitAdapter } from "../lib/market/adapters/whitebit";
import type { MarketAdapter } from "../lib/market/adapters/base";
import { CoalescedPublisher, MarketStore } from "../lib/market/engine/store";
import { DEFAULT_SYMBOL, normalizeSymbol } from "../lib/market/symbols";
import type { MarketEvent, WorkerCommand, WorkerEvent } from "../lib/market/types";

const workerScope = self as DedicatedWorkerGlobalScope;
let store = new MarketStore([DEFAULT_SYMBOL]);
let adapters: MarketAdapter[] = [];
let activeSymbol = DEFAULT_SYMBOL;

const publisher = new CoalescedPublisher(() => {
  const event: WorkerEvent = { type: "snapshot", data: store.snapshot() };
  workerScope.postMessage(event);
}, 150);

function receive(event: MarketEvent): void {
  store.apply(event);
  publisher.markDirty();
}

function start(symbol: string): void {
  const normalized = normalizeSymbol(symbol);
  if (adapters.length && normalized === activeSymbol) return;
  stopAdapters();
  activeSymbol = normalized;
  store = new MarketStore([activeSymbol]);
  adapters = [
    new BinanceAdapter(receive, activeSymbol),
    new BybitAdapter(receive, activeSymbol),
    new OkxAdapter(receive, activeSymbol),
    new MexcAdapter(receive, activeSymbol),
    new WhitebitAdapter(receive, activeSymbol),
    new BingxAdapter(receive, activeSymbol),
    new BitunixAdapter(receive, activeSymbol),
  ];
  for (const adapter of adapters) adapter.start();
  publisher.markDirty();
}

function stopAdapters(): void {
  for (const adapter of adapters) adapter.stop();
  adapters = [];
}

function stop(): void {
  stopAdapters();
  publisher.stop();
}

workerScope.onmessage = (message: MessageEvent<WorkerCommand>) => {
  if (message.data.type === "stop") stop();
  else start(message.data.symbol);
};

workerScope.addEventListener("error", (error) => {
  const event: WorkerEvent = { type: "worker-error", message: error.message };
  workerScope.postMessage(event);
});

export {};
