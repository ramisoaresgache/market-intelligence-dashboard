"use client";

import { useEffect, useRef, useState } from "react";
import { consolidateOrderBooks, type DepthLevel } from "./engine/visualization";
import type { ExchangeFilter, MarketSnapshot, NormalizedOrderBook } from "./types";

export interface LiquidityFrame {
  ts: number;
  mid: number;
  levels: DepthLevel[];
}

type SymbolHistory = {
  key: string;
  frames: LiquidityFrame[];
};

const SAMPLE_INTERVAL_MS = 2_000;
const MAX_FRAMES = 90;

export function useLiquidityHistory(
  symbol: string,
  snapshot: MarketSnapshot | undefined,
  exchange: ExchangeFilter = "all",
): LiquidityFrame[] {
  const key = `${symbol}:${exchange}`;
  const [history, setHistory] = useState<SymbolHistory>({ key, frames: [] });
  const [central, setCentral] = useState<SymbolHistory>({ key, frames: [] });
  const lastSample = useRef({ key, ts: 0 });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/orderbook-history?symbol=${encodeURIComponent(symbol)}&exchange=${exchange}&hours=4`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { frames?: CentralFrame[]; data?: CentralFrame[] };
        const raw = payload.frames ?? payload.data ?? [];
        const frames = raw.map(normalizeCentralFrame).filter((frame): frame is LiquidityFrame => frame !== null);
        if (active) setCentral({ key, frames: frames.slice(-480) });
      } catch {
        if (active) setCentral({ key, frames: [] });
      }
    };
    setTimeout(() => setCentral({ key, frames: [] }), 0);
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [exchange, key, symbol]);

  useEffect(() => {
    if (lastSample.current.key !== key) {
      lastSample.current = { key, ts: 0 };
    }
    if (!snapshot || snapshot.ts <= 0) {
      setTimeout(() => setHistory({ key, frames: [] }), 0);
      return;
    }
    const selectedBooks = filterOrderBooks(snapshot.orderBooks, exchange);
    const sourceTs = selectedBooks.reduce((latest, book) => Math.max(latest, book.ts), 0);
    if (!sourceTs || sourceTs - lastSample.current.ts < SAMPLE_INTERVAL_MS) return;
    const book = consolidateOrderBooks(selectedBooks);
    if (book.mid === null || !book.levels.length) return;
    const frame: LiquidityFrame = {
      ts: sourceTs,
      mid: book.mid,
      levels: [...book.levels]
        .sort((left, right) => Math.abs(left.price - book.mid!) - Math.abs(right.price - book.mid!))
        .slice(0, 600),
    };

    setTimeout(() => {
      lastSample.current = { key, ts: sourceTs };
      setHistory((current) => {
        const frames = current.key === key ? current.frames : [];
        return {
          key,
          frames: [...frames.slice(-(MAX_FRAMES - 1)), frame],
        };
      });
    }, 0);
  }, [exchange, key, snapshot]);

  const local = history.key === key ? history.frames : [];
  const remote = central.key === key ? central.frames : [];
  return mergeFrames(remote, local);
}

export function filterOrderBooks(
  books: NormalizedOrderBook[],
  exchange: ExchangeFilter,
): NormalizedOrderBook[] {
  return exchange === "all" ? books : books.filter((book) => book.exchange === exchange);
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
