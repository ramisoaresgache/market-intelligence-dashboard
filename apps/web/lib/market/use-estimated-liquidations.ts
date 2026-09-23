"use client";

import { useEffect, useRef, useState } from "react";
import {
  estimateLiquidationZones,
  type DerivativesSample,
  type EstimatedLiquidationZone,
} from "./engine/estimated-liquidations";
import { consolidateOrderBooks } from "./engine/visualization";
import type { MarketSnapshot } from "./types";

type ModelHistory = {
  symbol: string;
  samples: DerivativesSample[];
  zones: EstimatedLiquidationZone[];
};

const SAMPLE_INTERVAL_MS = 2_000;
const MAX_SAMPLES = 360;
const MAX_ZONES = 600;

export function useEstimatedLiquidations(
  symbol: string,
  snapshot: MarketSnapshot | undefined,
): ModelHistory {
  const [history, setHistory] = useState<ModelHistory>({
    symbol,
    samples: [],
    zones: [],
  });
  const lastSample = useRef({ symbol, ts: 0 });

  useEffect(() => {
    if (lastSample.current.symbol !== symbol) {
      lastSample.current = { symbol, ts: 0 };
    }
    if (!snapshot || snapshot.ts <= 0) return;
    if (snapshot.ts - lastSample.current.ts < SAMPLE_INTERVAL_MS) return;

    const sample = createSample(snapshot);
    if (!sample) return;
    lastSample.current = { symbol, ts: sample.ts };

    setTimeout(() => {
      setHistory((current) => {
        const samples = current.symbol === symbol ? current.samples : [];
        const zones = current.symbol === symbol ? current.zones : [];
        const previous = samples.at(-1);
        const nextSample = {
          ...sample,
          volatility: realizedVolatility(samples, sample.price),
        };
        const additions = previous ? estimateLiquidationZones(previous, nextSample) : [];
        return {
          symbol,
          samples: [...samples.slice(-(MAX_SAMPLES - 1)), nextSample],
          zones: [...zones, ...additions].slice(-MAX_ZONES),
        };
      });
    }, 0);
  }, [snapshot, symbol]);

  if (history.symbol !== symbol) return { symbol, samples: [], zones: [] };
  return history;
}

function realizedVolatility(samples: DerivativesSample[], nextPrice: number): number {
  const prices = [...samples.slice(-19).map((sample) => sample.price), nextPrice];
  if (prices.length < 3) return 0.01;
  const returns = prices.slice(1).map((value, index) => Math.log(value / prices[index]));
  const variance = returns.reduce((sum, value) => sum + value ** 2, 0) / returns.length;
  return Math.max(0.001, Math.sqrt(variance));
}

function createSample(snapshot: MarketSnapshot): DerivativesSample | null {
  const bybit = snapshot.metrics.find((metric) => metric.exchange === "bybit");
  const book = consolidateOrderBooks(snapshot.orderBooks);
  const price = bybit?.markPrice ?? bybit?.lastPrice ?? book.mid;
  if (price == null || price <= 0) return null;

  const values = snapshot.metrics.flatMap((metric) => {
    if (metric.openInterestValue != null) return [metric.openInterestValue];
    if (metric.openInterest != null) return [metric.openInterest * price];
    return [];
  });
  const openInterestValue = values.reduce((sum, value) => sum + value, 0);
  if (openInterestValue <= 0) return null;

  return {
    ts: snapshot.ts,
    price,
    openInterestValue,
    fundingRate: bybit?.fundingRate ?? 0,
    volatility: 0.01,
  };
}
