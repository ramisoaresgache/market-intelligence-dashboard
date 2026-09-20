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
export const LIQUIDITY_RETENTION_MS = 4 * 60 * 60 * 1000;

type HistoryState = {
  symbol: string;
  frames: LiquidityFrame[];
};

export function useLiquidityHistory(symbol: string, books: NormalizedOrderBook[]): LiquidityFrame[] {
  const [history, setHistory] = useState<HistoryState>({ symbol, frames: [] });
  const booksRef = useRef<NormalizedOrderBook[]>(books);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    let active = true;
    let sampleCount = 0;
    const since = Date.now() - LIQUIDITY_RETENTION_MS;

    void loadLiquidityFrames(symbol, since)
      .then((stored) => {
        if (active) setHistory({ symbol, frames: stored });
      })
      .catch(() => {
        if (active) setHistory({ symbol, frames: [] });
      });

    const timer = setInterval(() => {
      const frame = buildLiquidityFrame(symbol, booksRef.current);
      if (!frame) return;
      const cutoff = Date.now() - LIQUIDITY_RETENTION_MS;
      setHistory((current) => ({
        symbol,
        frames: [
          ...(current.symbol === symbol
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
  }, [symbol]);

  return history.symbol === symbol ? history.frames : [];
}
