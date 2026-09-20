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
