/// <reference lib="webworker" />

import { BinanceAdapter } from "../lib/market/adapters/binance";
import { BybitAdapter } from "../lib/market/adapters/bybit";
import { BingxAdapter } from "../lib/market/adapters/bingx";
import { BitunixAdapter } from "../lib/market/adapters/bitunix";
import { CoalescedPublisher, MarketStore } from "../lib/market/engine/store";
import type { MarketAdapter } from "../lib/market/adapters/base";
import type { MarketEvent, WorkerCommand, WorkerEvent } from "../lib/market/types";

const workerScope = self as DedicatedWorkerGlobalScope;
const store = new MarketStore();
const publisher = new CoalescedPublisher(() => {
  const event: WorkerEvent = { type: "snapshot", data: store.snapshot() };
  workerScope.postMessage(event);
}, 150);

let adapters: MarketAdapter[] = [];

function receive(event: MarketEvent): void {
  store.apply(event);
  publisher.markDirty();
}

function start(): void {
  if (adapters.length) return;
  adapters = [
    new BinanceAdapter(receive),
    new BybitAdapter(receive),
    new BingxAdapter(receive),
    new BitunixAdapter(receive),
  ];
  for (const adapter of adapters) adapter.start();
}

function stop(): void {
  for (const adapter of adapters) adapter.stop();
  adapters = [];
  publisher.stop();
}

workerScope.onmessage = (message: MessageEvent<WorkerCommand>) => {
  if (message.data.type === "start") start();
  else stop();
};

workerScope.addEventListener("error", (error) => {
  const event: WorkerEvent = { type: "worker-error", message: error.message };
  workerScope.postMessage(event);
});

export {};
