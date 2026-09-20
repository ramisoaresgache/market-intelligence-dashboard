"use client";

import { useEffect, useRef } from "react";
import type { LiquidityFrame } from "../lib/market/types";

interface LiquidityHeatmapProps {
  frames: LiquidityFrame[];
  windowMs: number;
  currentPrice: number | null;
}

export function LiquidityHeatmap({ frames, windowMs, currentPrice }: LiquidityHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => drawHeatmap(canvas, frames, windowMs, currentPrice);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [frames, windowMs, currentPrice]);

  return <canvas ref={canvasRef} className="heatmap-canvas" aria-label="Mapa de liquidez" />;
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  frames: LiquidityFrame[],
  windowMs: number,
  currentPrice: number | null,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(300, rect.height);
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
    ctx.fillText("Recolectando historial de liquidez…", width / 2, height / 2);
    return;
  }

  const margin = { left: 66, right: 14, top: 18, bottom: 28 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const span = price * 0.025;
  const minPrice = price - span;
  const maxPrice = price + span;
  const values = visible.flatMap((frame) =>
    frame.levels
      .filter((level) => level.price >= minPrice && level.price <= maxPrice)
      .flatMap((level) => [level.bidNotional, level.askNotional]),
  );
  const maxLog = Math.max(1, ...values.map((value) => Math.log1p(value)));
  const columnWidth = Math.max(1, plotWidth / Math.max(visible.length, 1));

  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#758091";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "right";
  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const y = margin.top + ratio * plotHeight;
    const label = maxPrice - ratio * (maxPrice - minPrice);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(formatPrice(label), margin.left - 8, y + 3);
  }

  visible.forEach((frame, frameIndex) => {
    const x = margin.left + frameIndex * columnWidth;
    const cellHeight = Math.max(2, (frame.bucketSize / (maxPrice - minPrice)) * plotHeight + 1);
    for (const level of frame.levels) {
      if (level.price < minPrice || level.price > maxPrice) continue;
      const y = margin.top + ((maxPrice - level.price) / (maxPrice - minPrice)) * plotHeight;
      if (level.bidNotional > 0) {
        const intensity = Math.log1p(level.bidNotional) / maxLog;
        ctx.fillStyle = `rgba(71, 209, 155, ${0.08 + intensity * 0.82})`;
        ctx.fillRect(x, y - cellHeight / 2, columnWidth + 0.5, cellHeight);
      }
      if (level.askNotional > 0) {
        const intensity = Math.log1p(level.askNotional) / maxLog;
        ctx.fillStyle = `rgba(255, 107, 122, ${0.08 + intensity * 0.82})`;
        ctx.fillRect(x, y - cellHeight / 2, columnWidth + 0.5, cellHeight);
      }
    }
  });

  const currentY = margin.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
  ctx.strokeStyle = "rgba(53,217,220,.95)";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(margin.left, currentY);
  ctx.lineTo(width - margin.right, currentY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#35d9dc";
  ctx.textAlign = "left";
  ctx.fillText(`Precio ${formatPrice(price)}`, margin.left + 8, Math.max(12, currentY - 6));

  ctx.fillStyle = "#758091";
  ctx.textAlign = "left";
  ctx.fillText(formatTime(visible[0]?.ts ?? latestTs), margin.left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(formatTime(latestTs), width - margin.right, height - 8);
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
