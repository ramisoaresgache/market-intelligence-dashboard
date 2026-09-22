"use client";

import { useEffect, useRef, useState } from "react";
import { buildLiquidityFrame } from "./engine/aggregate";
import {
  loadLiquidityFrames,
  pruneLiquidityFrames,
  saveLiquidityFrame,
} from "./history-db";
import type { LiquidityFrame, NormalizedOrderBook } from "./types";

const SAMPLE_INTERVAL_MS = 5_000;
const CENTRAL_REFRESH_MS = 60_000;
const CENTRAL_HISTORY_HOURS = 4;
export const LIQUIDITY_RETENTION_MS = 4 * 60 * 60 * 1000;

type HistoryState = {
  key: string;
  frames: LiquidityFrame[];
};

type CentralPayload = {
  symbol: string;
  exchange: string;
  frames?: LiquidityFrame[];
};

export function useLiquidityHistory(key: string, books: NormalizedOrderBook[]): LiquidityFrame[] {
  const [localHistory, setLocalHistory] = useState<HistoryState>({ key, frames: [] });
  const [centralHistory, setCentralHistory] = useState<HistoryState>({ key, frames: [] });
  const booksRef = useRef<NormalizedOrderBook[]>(books);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    let active = true;
    let sampleCount = 0;
    const since = Date.now() - LIQUIDITY_RETENTION_MS;

    void loadLiquidityFrames(key, since)
      .then((stored) => {
        if (active) setLocalHistory({ key, frames: stored });
      })
      .catch(() => {
        if (active) setLocalHistory({ key, frames: [] });
      });

    const timer = setInterval(() => {
      const frame = buildLiquidityFrame(key, booksRef.current);
      if (!frame) return;
      const cutoff = Date.now() - LIQUIDITY_RETENTION_MS;
      setLocalHistory((current) => ({
        key,
        frames: [
          ...(current.key === key
            ? current.frames.filter((item) => item.ts >= cutoff)
            : []),
          frame,
        ],
      }));
      void saveLiquidityFrame(frame).catch(() => undefined);
      sampleCount += 1;
      if (sampleCount % 60 === 0) {
        void pruneLiquidityFrames(cutoff).catch(() => undefined);
      }
    }, SAMPLE_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const [marketSymbol, rawExchange = "all"] = key.split("::");
    const exchange = rawExchange || "all";

    const loadCentral = async () => {
      if (!marketSymbol) return;
      try {
        const params = new URLSearchParams({
          symbol: marketSymbol,
          exchange,
          hours: String(CENTRAL_HISTORY_HOURS),
        });
        const response = await fetch(`/api/orderbook-history?${params}`, { cache: "no-store" });
        const payload = (await response.json()) as CentralPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (active) {
          setCentralHistory({
            key,
            frames: Array.isArray(payload.frames) ? payload.frames : [],
          });
        }
      } catch {
        if (active) setCentralHistory({ key, frames: [] });
      }
    };

    void loadCentral();
    timer = window.setInterval(() => void loadCentral(), CENTRAL_REFRESH_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [key]);

  const local = localHistory.key === key ? localHistory.frames : [];
  const central = centralHistory.key === key ? centralHistory.frames : [];
  const cutoff = Date.now() - LIQUIDITY_RETENTION_MS;
  return [...central, ...local]
    .filter((frame) => frame.ts >= cutoff)
    .sort((left, right) => left.ts - right.ts);
}
