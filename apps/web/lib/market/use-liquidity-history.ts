"use client";

import { useEffect, useRef, useState } from "react";
import { consolidateOrderBooks, type DepthLevel } from "./engine/visualization";
import type { MarketSnapshot } from "./types";

export interface LiquidityFrame {
  ts: number;
  mid: number;
  levels: DepthLevel[];
}

type SymbolHistory = {
  symbol: string;
  frames: LiquidityFrame[];
};

const SAMPLE_INTERVAL_MS = 2_000;
const MAX_FRAMES = 90;

export function useLiquidityHistory(
  symbol: string,
  snapshot: MarketSnapshot | undefined,
): LiquidityFrame[] {
  const [history, setHistory] = useState<SymbolHistory>({ symbol, frames: [] });
  const lastSample = useRef({ symbol, ts: 0 });

  useEffect(() => {
    if (lastSample.current.symbol !== symbol) {
      lastSample.current = { symbol, ts: 0 };
    }
    if (!snapshot || snapshot.ts <= 0) {
      setTimeout(() => setHistory({ symbol, frames: [] }), 0);
      return;
    }
    if (snapshot.ts - lastSample.current.ts < SAMPLE_INTERVAL_MS) return;

    const book = consolidateOrderBooks(snapshot.orderBooks);
    if (book.mid === null || !book.levels.length) return;
    const frame: LiquidityFrame = {
      ts: snapshot.ts,
      mid: book.mid,
      levels: [...book.levels]
        .sort(
          (left, right) =>
            right.bidNotional + right.askNotional - (left.bidNotional + left.askNotional),
        )
        .slice(0, 100),
    };

    setTimeout(() => {
      lastSample.current = { symbol, ts: snapshot.ts };
      setHistory((current) => {
        const frames = current.symbol === symbol ? current.frames : [];
        return {
          symbol,
          frames: [...frames.slice(-(MAX_FRAMES - 1)), frame],
        };
      });
    }, 0);
  }, [snapshot, symbol]);

  return history.symbol === symbol ? history.frames : [];
}
