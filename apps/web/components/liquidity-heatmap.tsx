"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoricalCandle, LiquidationMapPayload } from "../lib/market/liquidation-model";
import type { LiquidityFrame, LiquidityLevel } from "../lib/market/types";

interface LiquidityHeatmapProps {
  symbol: string;
  frames: LiquidityFrame[];
  windowMs: number;
  currentPrice: number | null;
}

type CandleState = {
  symbol: string;
  candles: HistoricalCandle[];
};

export function LiquidityHeatmap({ symbol, frames, windowMs, currentPrice }: LiquidityHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candleState, setCandleState] = useState<CandleState>({ symbol: "", candles: [] });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const loadCandles = async () => {
      try {
        const params = new URLSearchParams({ symbol, hours: "4", source: "binance" });
        const response = await fetch(`/api/liquidation-map?${params}`, { cache: "no-store" });
        const payload = (await response.json()) as LiquidationMapPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (active) setCandleState({ symbol, candles: payload.candles });
      } catch {
        if (active) setCandleState({ symbol, candles: [] });
      }
    };

    void loadCandles();
    timer = window.setInterval(() => void loadCandles(), 60_000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [symbol]);

  const candles = useMemo(
    () => candleState.symbol === symbol ? candleState.candles : [],
    [candleState, symbol],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => drawHeatmap(canvas, frames, candles, windowMs, currentPrice);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [frames, candles, windowMs, currentPrice]);

  return <canvas ref={canvasRef} className="heatmap-canvas" aria-label="Mapa de liquidez" />;
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  frames: LiquidityFrame[],
  candles: HistoricalCandle[],
  windowMs: number,
  currentPrice: number | null,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(320, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090d13";
  ctx.fillRect(0, 0, width, height);

  const latestTs = frames.at(-1)?.ts ?? Date.now();
  const visible = frames.filter((frame) => frame.ts >= latestTs - windowMs);
  const price = currentPrice ?? visible.at(-1)?.midpoint ?? null;

  if (!visible.length || price === null) {
    ctx.fillStyle = "#758091";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Recolectando historial de liquidez…", width / 2, height / 2 - 8);
    ctx.font = "11px system-ui";
    ctx.fillText("El primer mapa empieza a formarse después de las primeras muestras.", width / 2, height / 2 + 14);
    return;
  }

  const margin = { left: 72, right: 12, top: 24, bottom: 32 };
  const profileWidth = width >= 720 ? 116 : 84;
  const profileGap = 18;
  const plotWidth = Math.max(120, width - margin.left - margin.right - profileWidth - profileGap);
  const plotHeight = height - margin.top - margin.bottom;
  const plotRight = margin.left + plotWidth;
  const profileLeft = plotRight + profileGap;
  const latestFrame = visible.at(-1) as LiquidityFrame;
  const earliestTs = visible[0]?.ts ?? latestTs;
  const visibleCandles = candles.filter((candle) => {
    const candleEnd = candle.ts + 5 * 60 * 1000;
    return candleEnd >= earliestTs && candle.ts <= latestTs;
  });
  const visibleLevels = visible.flatMap((frame) =>
    frame.levels.filter((level) => level.bidNotional > 0 || level.askNotional > 0),
  );
  const { minPrice, maxPrice } = adaptivePriceRange(
    visibleLevels,
    price,
    latestFrame.bucketSize,
    visibleCandles,
  );
  const priceRange = Math.max(Number.EPSILON, maxPrice - minPrice);
  const values = visibleLevels.flatMap((level) => [level.bidNotional, level.askNotional]);
  const maxLog = Math.max(1, ...values.map((value) => Math.log1p(value)));
  const timeRange = Math.max(1, latestTs - earliestTs);

  drawGrid(ctx, margin.left, plotRight, margin.top, plotHeight, minPrice, maxPrice);

  for (const frame of visible) {
    const timeRatio = timeRange <= 1 ? 1 : (frame.ts - earliestTs) / timeRange;
    const x = margin.left + timeRatio * plotWidth;
    const nextFrameWidth = Math.max(3, plotWidth / Math.max(visible.length - 1, 1) + 1);
    const bucketPixels = (frame.bucketSize / priceRange) * plotHeight;
    const cellHeight = clamp(bucketPixels * 1.7, 5, 18);

    for (const level of frame.levels) {
      if (level.price < minPrice || level.price > maxPrice) continue;
      const y = priceToY(level.price, minPrice, maxPrice, margin.top, plotHeight);
      if (level.bidNotional > 0) {
        drawLiquidityCell(
          ctx,
          x,
          y,
          nextFrameWidth,
          cellHeight,
          level.bidNotional,
          maxLog,
          "bid",
        );
      }
      if (level.askNotional > 0) {
        drawLiquidityCell(
          ctx,
          x,
          y,
          nextFrameWidth,
          cellHeight,
          level.askNotional,
          maxLog,
          "ask",
        );
      }
    }
  }

  drawOrderbookCandles(
    ctx,
    visibleCandles,
    margin.left,
    plotRight,
    margin.top,
    plotHeight,
    earliestTs,
    latestTs,
    minPrice,
    maxPrice,
  );

  const currentY = priceToY(price, minPrice, maxPrice, margin.top, plotHeight);
  ctx.strokeStyle = "rgba(53,217,220,.95)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(margin.left, currentY);
  ctx.lineTo(plotRight, currentY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#35d9dc";
  ctx.textAlign = "left";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.fillText(`PRECIO ${formatPrice(price)}`, margin.left + 8, Math.max(13, currentY - 7));

  drawCurrentProfile(
    ctx,
    latestFrame.levels,
    profileLeft,
    profileWidth,
    margin.top,
    plotHeight,
    minPrice,
    maxPrice,
  );

  ctx.fillStyle = "#758091";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(formatTime(earliestTs), margin.left, height - 9);
  ctx.textAlign = "right";
  ctx.fillText(formatTime(latestTs), plotRight, height - 9);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(71,209,155,.95)";
  ctx.fillText("■ compras", profileLeft, height - 9);
  ctx.fillStyle = "rgba(255,107,122,.95)";
  ctx.fillText("■ ventas", profileLeft + Math.min(66, profileWidth * 0.54), height - 9);
  ctx.fillStyle = "#d9e2ee";
  ctx.textAlign = "right";
  ctx.fillText("VELAS BINANCE · 5 M", plotRight, Math.max(11, margin.top - 8));
}

function drawOrderbookCandles(
  ctx: CanvasRenderingContext2D,
  candles: HistoricalCandle[],
  left: number,
  right: number,
  top: number,
  height: number,
  minTs: number,
  maxTs: number,
  minPrice: number,
  maxPrice: number,
): void {
  if (!candles.length) return;
  const plotWidth = right - left;
  const duration = Math.max(1, maxTs - minTs);
  const bodyWidth = clamp((plotWidth / candles.length) * 0.58, 2, 8);

  for (const candle of candles) {
    const centerTs = candle.ts + 2.5 * 60 * 1000;
    const x = left + ((centerTs - minTs) / duration) * plotWidth;
    if (x < left - bodyWidth || x > right + bodyWidth) continue;
    const openY = priceToY(candle.open, minPrice, maxPrice, top, height);
    const closeY = priceToY(candle.close, minPrice, maxPrice, top, height);
    const highY = priceToY(candle.high, minPrice, maxPrice, top, height);
    const lowY = priceToY(candle.low, minPrice, maxPrice, top, height);
    const rising = candle.close >= candle.open;
    const color = rising ? "#55f0c2" : "#ff5c7e";

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(
      x - bodyWidth / 2,
      Math.min(openY, closeY),
      bodyWidth,
      Math.max(1.5, Math.abs(closeY - openY)),
    );
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  top: number,
  height: number,
  minPrice: number,
  maxPrice: number,
): void {
  ctx.strokeStyle = "rgba(255,255,255,.065)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#758091";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "right";

  for (let step = 0; step <= 5; step += 1) {
    const ratio = step / 5;
    const y = top + ratio * height;
    const label = maxPrice - ratio * (maxPrice - minPrice);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillText(formatPrice(label), left - 9, y + 3);
  }
}

function drawLiquidityCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  notional: number,
  maxLog: number,
  side: "bid" | "ask",
): void {
  const intensity = Math.log1p(notional) / maxLog;
  const alpha = 0.14 + intensity * 0.8;
  ctx.fillStyle =
    side === "bid"
      ? `rgba(71, 209, 155, ${alpha})`
      : `rgba(255, 107, 122, ${alpha})`;
  ctx.fillRect(x - width, y - height / 2, width + 1, height);
}

function drawCurrentProfile(
  ctx: CanvasRenderingContext2D,
  levels: LiquidityLevel[],
  left: number,
  width: number,
  top: number,
  height: number,
  minPrice: number,
  maxPrice: number,
): void {
  const visible = levels.filter((level) => level.price >= minPrice && level.price <= maxPrice);
  const maxValue = Math.max(
    1,
    ...visible.flatMap((level) => [Math.log1p(level.bidNotional), Math.log1p(level.askNotional)]),
  );

  ctx.fillStyle = "#758091";
  ctx.font = "bold 9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("LIQUIDEZ AHORA", left, Math.max(10, top - 8));

  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.beginPath();
  ctx.moveTo(left - 8, top);
  ctx.lineTo(left - 8, top + height);
  ctx.stroke();

  for (const level of visible) {
    const y = priceToY(level.price, minPrice, maxPrice, top, height);
    if (level.bidNotional > 0) {
      const bar = (Math.log1p(level.bidNotional) / maxValue) * width;
      ctx.fillStyle = "rgba(71,209,155,.72)";
      ctx.fillRect(left, y - 3, bar, 5);
    }
    if (level.askNotional > 0) {
      const bar = (Math.log1p(level.askNotional) / maxValue) * width;
      ctx.fillStyle = "rgba(255,107,122,.72)";
      ctx.fillRect(left, y - 3, bar, 5);
    }
  }
}

function adaptivePriceRange(
  levels: LiquidityLevel[],
  currentPrice: number,
  bucketSize: number,
  candles: HistoricalCandle[],
): { minPrice: number; maxPrice: number } {
  const prices = levels.map((level) => level.price).filter(Number.isFinite).sort((a, b) => a - b);
  const minimumHalfRange = Math.max(currentPrice * 0.0015, bucketSize * 8);
  if (!prices.length) {
    return {
      minPrice: currentPrice - minimumHalfRange,
      maxPrice: currentPrice + minimumHalfRange,
    };
  }

  const lower = percentile(prices, 0.03);
  const upper = percentile(prices, 0.97);
  let minPrice = Math.min(lower, currentPrice - minimumHalfRange);
  let maxPrice = Math.max(upper, currentPrice + minimumHalfRange);
  if (candles.length) {
    minPrice = Math.min(minPrice, ...candles.map((candle) => candle.low));
    maxPrice = Math.max(maxPrice, ...candles.map((candle) => candle.high));
  }
  const padding = Math.max((maxPrice - minPrice) * 0.06, bucketSize * 2);
  minPrice -= padding;
  maxPrice += padding;
  return { minPrice, maxPrice };
}

function percentile(sorted: number[], ratio: number): number {
  if (!sorted.length) return 0;
  const index = clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index] ?? sorted[0] ?? 0;
}

function priceToY(
  price: number,
  minPrice: number,
  maxPrice: number,
  top: number,
  height: number,
): number {
  return top + ((maxPrice - price) / Math.max(Number.EPSILON, maxPrice - minPrice)) * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatPrice(value: number): string {
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return value.toLocaleString("es-AR", { maximumFractionDigits: decimals });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
