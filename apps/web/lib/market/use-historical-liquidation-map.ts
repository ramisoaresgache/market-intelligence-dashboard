"use client";

import { useEffect, useState } from "react";
import {
  estimateLiquidationZones,
  type DerivativesSample,
  type EstimatedLiquidationZone,
} from "./engine/estimated-liquidations";

const REST_BASE = "https://fapi.binance.com";
const INTERVAL = "5m";
const LIMIT = 288;
const REFRESH_MS = 60_000;

export interface HistoricalCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface OpenInterestPoint {
  ts: number;
  value: number;
}

type HistoricalMapData = {
  candles: HistoricalCandle[];
  zones: EstimatedLiquidationZone[];
  state: "loading" | "live" | "unavailable";
};

export function useHistoricalLiquidationMap(symbol: string): HistoricalMapData {
  const [data, setData] = useState<HistoricalMapData>({
    candles: [],
    zones: [],
    state: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const [candleResponse, oiResponse] = await Promise.all([
          fetch(`${REST_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL}&limit=${LIMIT}`, { signal: controller.signal }),
          fetch(`${REST_BASE}/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${INTERVAL}&limit=${LIMIT}`, { signal: controller.signal }),
        ]);
        if (!candleResponse.ok || !oiResponse.ok) {
          throw new Error(`Historical market data HTTP ${candleResponse.status}/${oiResponse.status}`);
        }
        const candles = parseBinanceKlines(await candleResponse.json());
        const openInterest = parseBinanceOpenInterest(await oiResponse.json());
        setData({
          candles,
          zones: buildHistoricalZones(candles, openInterest),
          state: "live",
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Historical liquidation context unavailable", error);
          setData((current) => ({ ...current, state: "unavailable" }));
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, REFRESH_MS);
      }
    };

    void load();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [symbol]);

  return data;
}

export function parseBinanceKlines(raw: unknown): HistoricalCandle[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!Array.isArray(item) || item.length < 7) return [];
    const candle = {
      openTime: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      closeTime: Number(item[6]),
    };
    return Object.values(candle).every(Number.isFinite) ? [candle] : [];
  });
}

export function parseBinanceOpenInterest(raw: unknown): OpenInterestPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const point = {
      ts: Number(record.timestamp),
      value: Number(record.sumOpenInterestValue),
    };
    return Number.isFinite(point.ts) && Number.isFinite(point.value) ? [point] : [];
  });
}

export function buildHistoricalZones(
  candles: HistoricalCandle[],
  openInterest: OpenInterestPoint[],
): EstimatedLiquidationZone[] {
  if (candles.length < 2 || openInterest.length < 2) return [];
  const samples = openInterest.flatMap((point) => {
    const candle = closestCandle(candles, point.ts);
    if (!candle) return [];
    const volatility = Math.max(0.001, (candle.high - candle.low) / candle.open);
    return [{
      ts: point.ts,
      price: candle.close,
      openInterestValue: point.value,
      fundingRate: 0,
      volatility,
    } satisfies DerivativesSample];
  });

  return samples.slice(1).flatMap((sample, index) =>
    estimateLiquidationZones(samples[index], sample),
  );
}

function closestCandle(
  candles: HistoricalCandle[],
  timestamp: number,
): HistoricalCandle | undefined {
  return candles.reduce<HistoricalCandle | undefined>((closest, candle) => {
    if (!closest) return candle;
    return Math.abs(candle.closeTime - timestamp) < Math.abs(closest.closeTime - timestamp)
      ? candle
      : closest;
  }, undefined);
}
