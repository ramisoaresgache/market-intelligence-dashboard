"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./liquidation-heatmap.module.css";
import type {
  EstimatedLiquidationZone,
  HistoricalCandle,
  LiquidationMapPayload,
  LiquidationMapSource,
} from "../lib/market/liquidation-model";

interface LiquidationHeatmapProps {
  symbol: string;
  hours: 4 | 12 | 24;
  source: LiquidationMapSource;
}

interface RequestState {
  key: string;
  payload: LiquidationMapPayload | null;
  error: string | null;
}

interface HoverInfo {
  requestKey: string;
  canvasWidth: number;
  x: number;
  y: number;
  ts: number;
  price: number;
  exposureUsd: number;
  longExposureUsd: number;
  shortExposureUsd: number;
  leverage: string;
}

interface Geometry {
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
  minPrice: number;
  maxPrice: number;
  minTs: number;
  maxTs: number;
}

type ColorStop = {
  p: number;
  rgb: readonly [number, number, number];
};

export function LiquidationHeatmap({ symbol, hours, source }: LiquidationHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestKey = `${symbol}-${hours}-${source}`;
  const [requestState, setRequestState] = useState<RequestState>({
    key: "",
    payload: null,
    error: null,
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const isCurrent = requestState.key === requestKey;
  const payload = isCurrent ? requestState.payload : null;
  const error = isCurrent ? requestState.error : null;
  const loading = !isCurrent || (payload === null && error === null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol, hours: String(hours), source });

    void fetch(`/api/liquidation-map?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as LiquidationMapPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setRequestState({ key: requestKey, payload: data, error: null });
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRequestState({
          key: requestKey,
          payload: null,
          error: reason instanceof Error ? reason.message : "No se pudo cargar el mapa",
        });
      });

    return () => controller.abort();
  }, [hours, requestKey, source, symbol]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    const render = () => drawMap(canvas, payload);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [payload]);

  const sourceLabel = useMemo(() => {
    if (!payload?.sourcesUsed.length) return "—";
    return payload.sourcesUsed.map((item) => capitalize(item)).join(" + ");
  }, [payload]);

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!payload || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const geometry = computeGeometry(payload, rect.width, rect.height);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < geometry.left ||
      x > geometry.right ||
      y < geometry.top ||
      y > geometry.bottom
    ) {
      setHover(null);
      return;
    }

    const ts =
      geometry.minTs +
      ((x - geometry.left) / geometry.plotWidth) * (geometry.maxTs - geometry.minTs);
    const price =
      geometry.maxPrice -
      ((y - geometry.top) / geometry.plotHeight) * (geometry.maxPrice - geometry.minPrice);
    const tolerance = (geometry.maxPrice - geometry.minPrice) / 45;
    const active = payload.zones.filter(
      (zone) =>
        ts >= zone.startTs &&
        ts <= zone.endTs + 5 * 60 * 1000 &&
        Math.abs(zone.price - price) <= tolerance,
    );
    const longExposureUsd = active
      .filter((zone) => zone.side === "long")
      .reduce((sum, zone) => sum + zone.exposureUsd, 0);
    const shortExposureUsd = active
      .filter((zone) => zone.side === "short")
      .reduce((sum, zone) => sum + zone.exposureUsd, 0);
    const exposureUsd = longExposureUsd + shortExposureUsd;
    const strongest = [...active].sort((a, b) => b.exposureUsd - a.exposureUsd)[0];

    setHover({
      requestKey,
      canvasWidth: rect.width,
      x,
      y,
      ts,
      price,
      exposureUsd,
      longExposureUsd,
      shortExposureUsd,
      leverage: strongest ? `${strongest.leverage}x` : "—",
    });
  }

  const activeHover = hover?.requestKey === requestKey ? hover : null;

  return (
    <div className={styles.shell}>
      <div className={styles.meta}>
        <span className={styles.badge}>ESTIMADO</span>
        <span>{hours} h históricas</span>
        <span>{sourceLabel}</span>
        {payload?.warnings.length ? <span title={payload.warnings.join(" · ")}>fuente parcial</span> : null}
      </div>

      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          aria-label="Mapa de liquidaciones estimadas"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
        />

        {loading && <div className={styles.overlay}>Calculando zonas de liquidación estimadas…</div>}
        {error && <div className={`${styles.overlay} ${styles.error}`}>{error}</div>}

        {activeHover && !loading && !error && (
          <div
            className={styles.tooltip}
            style={{
              left: `${Math.min(activeHover.x + 14, activeHover.canvasWidth - 205)}px`,
              top: `${Math.max(8, activeHover.y - 92)}px`,
            }}
          >
            <b>{formatPrice(activeHover.price)}</b>
            <span>{formatTime(activeHover.ts)}</span>
            <div>
              <span>Exposición estimada</span>
              <strong>{formatMoney(activeHover.exposureUsd)}</strong>
            </div>
            <div>
              <span>Longs / Shorts</span>
              <strong>
                {formatMoney(activeHover.longExposureUsd)} / {formatMoney(activeHover.shortExposureUsd)}
              </strong>
            </div>
            <div>
              <span>Apalancamiento dominante</span>
              <strong>{activeHover.leverage}</strong>
            </div>
          </div>
        )}
      </div>

      <div className={styles.legend}>
        <span>Menor concentración</span>
        <i />
        <span>Mayor concentración estimada</span>
      </div>
      <p className={styles.disclaimer}>
        Las bandas son una estimación propia basada en velas, volumen e interés abierto público. No
        representan posiciones individuales ni niveles exactos publicados por los exchanges.
      </p>
    </div>
  );
}

function drawMap(canvas: HTMLCanvasElement, payload: LiquidationMapPayload): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(440, rect.width);
  const height = Math.max(390, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#080b11";
  ctx.fillRect(0, 0, width, height);

  if (!payload.candles.length) {
    ctx.fillStyle = "#758091";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos históricos suficientes", width / 2, height / 2);
    return;
  }

  const geometry = computeGeometry(payload, width, height);
  drawGrid(ctx, geometry);
  drawZones(ctx, payload.zones, geometry);
  drawCandles(ctx, payload.candles, geometry);
  drawCurrentPrice(ctx, payload.candles, geometry);
  drawAxes(ctx, geometry);
}

function computeGeometry(payload: LiquidationMapPayload, width: number, height: number): Geometry {
  const left = 64;
  const right = width - 18;
  const top = 18;
  const bottom = height - 30;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const candles = payload.candles;
  const currentPrice = candles.at(-1)?.close ?? 1;
  const candleLow = Math.min(...candles.map((item) => item.low));
  const candleHigh = Math.max(...candles.map((item) => item.high));
  const candidateZones = payload.zones
    .map((zone) => zone.price)
    .filter((price) => price >= currentPrice * 0.88 && price <= currentPrice * 1.12)
    .sort((a, b) => a - b);
  const zoneLow = percentile(candidateZones, 0.02) ?? candleLow;
  const zoneHigh = percentile(candidateZones, 0.98) ?? candleHigh;
  const naturalLow = Math.min(candleLow, zoneLow);
  const naturalHigh = Math.max(candleHigh, zoneHigh);
  const minimumHalfRange = currentPrice * 0.03;
  const minPrice = Math.min(naturalLow, currentPrice - minimumHalfRange);
  const maxPrice = Math.max(naturalHigh, currentPrice + minimumHalfRange);
  const padding = Math.max((maxPrice - minPrice) * 0.025, currentPrice * 0.002);
  const minTs = candles[0]?.ts ?? Date.now();
  const maxTs = (candles.at(-1)?.ts ?? minTs) + 5 * 60 * 1000;

  return {
    left,
    right,
    top,
    bottom,
    plotWidth,
    plotHeight,
    minPrice: minPrice - padding,
    maxPrice: maxPrice + padding,
    minTs,
    maxTs,
  };
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  zones: EstimatedLiquidationZone[],
  geometry: Geometry,
): void {
  const visible = zones.filter(
    (zone) => zone.price >= geometry.minPrice && zone.price <= geometry.maxPrice,
  );
  const maxLog = Math.max(1, ...visible.map((zone) => Math.log1p(zone.exposureUsd)));
  const sorted = [...visible].sort((a, b) => a.exposureUsd - b.exposureUsd);

  for (const zone of sorted) {
    const x1 = timeToX(zone.startTs, geometry);
    const x2 = timeToX(zone.endTs + 5 * 60 * 1000, geometry);
    const y = priceToY(zone.price, geometry);
    const intensity = Math.log1p(zone.exposureUsd) / maxLog;
    const thickness = 2.5 + intensity * 7;
    ctx.fillStyle = intensityColor(intensity);
    ctx.fillRect(x1, y - thickness / 2, Math.max(2, x2 - x1), thickness);
  }
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  candles: HistoricalCandle[],
  geometry: Geometry,
): void {
  const bodyWidth = clamp((geometry.plotWidth / Math.max(candles.length, 1)) * 0.62, 1.5, 7);
  for (const candle of candles) {
    const x = timeToX(candle.ts + 2.5 * 60 * 1000, geometry);
    const openY = priceToY(candle.open, geometry);
    const closeY = priceToY(candle.close, geometry);
    const highY = priceToY(candle.high, geometry);
    const lowY = priceToY(candle.low, geometry);
    const rising = candle.close >= candle.open;
    const color = rising ? "rgba(68, 226, 158, .96)" : "rgba(255, 86, 110, .96)";

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
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

function drawCurrentPrice(
  ctx: CanvasRenderingContext2D,
  candles: HistoricalCandle[],
  geometry: Geometry,
): void {
  const price = candles.at(-1)?.close;
  if (price == null) return;
  const y = priceToY(price, geometry);
  ctx.strokeStyle = "rgba(235, 241, 248, .58)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(geometry.left, y);
  ctx.lineTo(geometry.right, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#edf2f7";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`PRECIO ${formatPrice(price)}`, geometry.left + 6, Math.max(11, y - 6));
}

function drawGrid(ctx: CanvasRenderingContext2D, geometry: Geometry): void {
  ctx.strokeStyle = "rgba(255,255,255,.055)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 5; step += 1) {
    const y = geometry.top + (step / 5) * geometry.plotHeight;
    ctx.beginPath();
    ctx.moveTo(geometry.left, y);
    ctx.lineTo(geometry.right, y);
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, geometry: Geometry): void {
  ctx.fillStyle = "#758091";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "right";
  for (let step = 0; step <= 5; step += 1) {
    const ratio = step / 5;
    const y = geometry.top + ratio * geometry.plotHeight;
    const price = geometry.maxPrice - ratio * (geometry.maxPrice - geometry.minPrice);
    ctx.fillText(formatPrice(price), geometry.left - 7, y + 3);
  }

  ctx.textAlign = "left";
  ctx.fillText(formatAxisTime(geometry.minTs), geometry.left, geometry.bottom + 18);
  ctx.textAlign = "center";
  ctx.fillText(
    formatAxisTime((geometry.minTs + geometry.maxTs) / 2),
    geometry.left + geometry.plotWidth / 2,
    geometry.bottom + 18,
  );
  ctx.textAlign = "right";
  ctx.fillText(formatAxisTime(geometry.maxTs), geometry.right, geometry.bottom + 18);
}

function timeToX(ts: number, geometry: Geometry): number {
  const ratio = clamp(
    (ts - geometry.minTs) / Math.max(1, geometry.maxTs - geometry.minTs),
    0,
    1,
  );
  return geometry.left + ratio * geometry.plotWidth;
}

function priceToY(price: number, geometry: Geometry): number {
  const ratio =
    (geometry.maxPrice - price) /
    Math.max(Number.EPSILON, geometry.maxPrice - geometry.minPrice);
  return geometry.top + ratio * geometry.plotHeight;
}

function intensityColor(intensity: number): string {
  const clamped = clamp(intensity, 0, 1);
  const stops: ColorStop[] = [
    { p: 0, rgb: [59, 15, 92] },
    { p: 0.28, rgb: [47, 72, 156] },
    { p: 0.52, rgb: [26, 158, 176] },
    { p: 0.75, rgb: [70, 196, 104] },
    { p: 1, rgb: [238, 226, 32] },
  ];
  let left = stops[0] as ColorStop;
  let right = stops[stops.length - 1] as ColorStop;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const candidateLeft = stops[index];
    const candidateRight = stops[index + 1];
    if (
      candidateLeft &&
      candidateRight &&
      clamped >= candidateLeft.p &&
      clamped <= candidateRight.p
    ) {
      left = candidateLeft;
      right = candidateRight;
      break;
    }
  }
  const local = (clamped - left.p) / Math.max(0.0001, right.p - left.p);
  const rgb = left.rgb.map((value, index) =>
    Math.round(value + ((right.rgb[index] ?? value) - value) * local),
  );
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.22 + clamped * 0.72})`;
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const index = Math.floor((values.length - 1) * ratio);
  return values[clamp(index, 0, values.length - 1)] ?? null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatPrice(value: number): string {
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 6;
  return value.toLocaleString("es-AR", { maximumFractionDigits: decimals });
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatAxisTime(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
