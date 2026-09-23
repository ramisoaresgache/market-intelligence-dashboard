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
  const [central, setCentral] = useState<SymbolHistory>({ symbol, frames: [] });
  const lastSample = useRef({ symbol, ts: 0 });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/orderbook-history?symbol=${encodeURIComponent(symbol)}&exchange=all&hours=4`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { frames?: CentralFrame[]; data?: CentralFrame[] };
        const raw = payload.frames ?? payload.data ?? [];
        const frames = raw.map(normalizeCentralFrame).filter((frame): frame is LiquidityFrame => frame !== null);
        if (active) setCentral({ symbol, frames: frames.slice(-480) });
      } catch {
        if (active) setCentral({ symbol, frames: [] });
      }
    };
    setTimeout(() => setCentral({ symbol, frames: [] }), 0);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [symbol]);

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
        .sort((left, right) => Math.abs(left.price - book.mid!) - Math.abs(right.price - book.mid!))
        .slice(0, 160),
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

  const local = history.symbol === symbol ? history.frames : [];
  const remote = central.symbol === symbol ? central.frames : [];
  return mergeFrames(remote, local);
}

type CentralFrame = {
  ts?: number | string;
  midpoint?: number;
  mid?: number;
  levels?: Array<Partial<DepthLevel> & { price?: number; bidNotional?: number; askNotional?: number }>;
};

function normalizeCentralFrame(raw: CentralFrame): LiquidityFrame | null {
  const ts = typeof raw.ts === "string" ? Date.parse(raw.ts) : Number(raw.ts);
  const mid = Number(raw.midpoint ?? raw.mid);
  const levels = (raw.levels ?? []).flatMap((level) => {
    const price = Number(level.price);
    const bidNotional = Number(level.bidNotional ?? 0);
    const askNotional = Number(level.askNotional ?? 0);
    if (![price, bidNotional, askNotional].every(Number.isFinite)) return [];
    return [{ price, bidNotional, askNotional, exchanges: level.exchanges ?? [] }];
  });
  return Number.isFinite(ts) && Number.isFinite(mid) && levels.length ? { ts, mid, levels } : null;
}

function mergeFrames(remote: LiquidityFrame[], local: LiquidityFrame[]): LiquidityFrame[] {
  const byTime = new Map<number, LiquidityFrame>();
  for (const frame of [...remote, ...local]) byTime.set(frame.ts, frame);
  return [...byTime.values()].sort((left, right) => left.ts - right.ts).slice(-500);
}
