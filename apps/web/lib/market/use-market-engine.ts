"use client";

import { useSyncExternalStore } from "react";
import { marketConnectionManager } from "./manager";

export function useMarketEngine() {
  return useSyncExternalStore(
    marketConnectionManager.subscribe,
    marketConnectionManager.getSnapshot,
    marketConnectionManager.getServerSnapshot,
  );
}

export function setMarketSymbol(symbol: string): void {
  marketConnectionManager.setSymbol(symbol);
}
