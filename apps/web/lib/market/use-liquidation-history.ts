"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadLiquidationEvents,
  pruneLiquidationEvents,
  saveLiquidationEvents,
} from "./history-db";
import {
  LIQUIDATION_RETENTION_MS,
  liquidationEventKey,
  mergeLiquidationEvents,
} from "./liquidation-history";
import type { LiquidationEvent } from "./types";

type LiquidationHistoryState = {
  symbol: string;
  events: LiquidationEvent[];
};

export function useLiquidationHistory(
  symbol: string,
  liveEvents: LiquidationEvent[],
): LiquidationEvent[] {
  const [history, setHistory] = useState<LiquidationHistoryState>({ symbol, events: [] });
  const knownKeys = useRef(new Set<string>());
  const persistedSincePrune = useRef(0);

  useEffect(() => {
    let active = true;
    knownKeys.current = new Set<string>();
    persistedSincePrune.current = 0;
    const since = Date.now() - LIQUIDATION_RETENTION_MS;

    void loadLiquidationEvents(symbol, since)
      .then((stored) => {
        if (!active) return;
        for (const event of stored) knownKeys.current.add(liquidationEventKey(event));
        setHistory({ symbol, events: stored });
      })
      .catch(() => {
        if (active) setHistory({ symbol, events: [] });
      });

    return () => {
      active = false;
    };
  }, [symbol]);

  useEffect(() => {
    if (!liveEvents.length) return;
    const fresh = liveEvents.filter((event) => {
      const key = liquidationEventKey(event);
      if (knownKeys.current.has(key)) return false;
      knownKeys.current.add(key);
      return true;
    });
    if (!fresh.length) return;

    const now = Date.now();
    setHistory((current) => ({
      symbol,
      events: mergeLiquidationEvents(current.symbol === symbol ? current.events : [], fresh, now),
    }));
    void saveLiquidationEvents(fresh).catch(() => undefined);

    persistedSincePrune.current += fresh.length;
    if (persistedSincePrune.current >= 250) {
      persistedSincePrune.current = 0;
      void pruneLiquidationEvents(now - LIQUIDATION_RETENTION_MS).catch(() => undefined);
    }
  }, [liveEvents, symbol]);

  return history.symbol === symbol ? history.events : [];
}
