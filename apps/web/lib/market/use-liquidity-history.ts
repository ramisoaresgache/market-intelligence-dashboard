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

export function useLiquidityHistory(symbol: string, books: NormalizedOrderBook[]): LiquidityFrame[] {
  const [frames, setFrames] = useState<LiquidityFrame[]>([]);
  const booksRef = useRef<NormalizedOrderBook[]>(books);

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    let active = true;
    let sampleCount = 0;
    const since = Date.now() - LIQUIDITY_RETENTION_MS;

    setFrames([]);
    void loadLiquidityFrames(symbol, since)
      .then((stored) => {
        if (active) setFrames(stored);
      })
      .catch(() => {
        if (active) setFrames([]);
      });

    const timer = setInterval(() => {
      const frame = buildLiquidityFrame(symbol, booksRef.current);
      if (!frame) return;
      const cutoff = Date.now() - LIQUIDITY_RETENTION_MS;
      setFrames((current) => [...current.filter((item) => item.ts >= cutoff), frame]);
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

  return frames;
}
