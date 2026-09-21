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

interface HeatmapGrid {
  xBins: number;
  yBins: number;
  values: Float64Array;
  lowLog: number;
  highLog: number;
}

type ColorStop = {
  p: number;
  rgb: readonly [number, number, number];
};

const DEFAULT_THRESHOLD = 0.28;
const Y_BINS = 96;

export function LiquidationHeatmap({ symbol, hours, source }: LiquidationHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestKey = `${symbol}-${hours}-${source}`;
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
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
    const render = () => drawMap(canvas, payload, threshold);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [payload, threshold]);

  const sourceLabel = useMemo(() => {
    if (!payload?.sourcesUsed.length) return "—";
    return payload.sourcesUsed.map(exchangeLabel).join(" + ");
  }, [payload]);

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!payload || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const geometry = computeGeometry(payload, rect.width, rect.height);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < geometry.left || x > geometry.right || y < geometry.top || y > geometry.bottom) {
      setHover(null);
      return;
    }

    const ts = geometry.minTs + ((x - geometry.left) / geometry.plotWidth) * (geometry.maxTs - geometry.minTs);
    const price = geometry.maxPrice - ((y - geometry.top) / geometry.plotHeight) * (geometry.maxPrice - geometry.minPrice);
    const priceBin = (geometry.maxPrice - geometry.minPrice) / Y_BINS;
    const active = payload.zones.filter(
      (zone) =>
        ts >= zone.startTs &&
        ts <= zone.endTs + 5 * 60 * 1000 &&
        Math.abs(zone.price - price) <= priceBin * 0.62,
    );
    const longExposureUsd = active
      .filter((zone) => zone.side === "long")
      .reduce((sum, zone) => sum + zone.exposureUsd, 0);
    const shortExposureUsd = active
      .filter((zone) => zone.side === "short")
      .reduce((sum, zone) => sum + zone.exposureUsd, 0);
    const strongest = [...active].sort((a, b) => b.exposureUsd - a.exposureUsd)[0];

    setHover({
      requestKey,
      canvasWidth: rect.width,
      x,
      y,
      ts,
      price,
      exposureUsd: longExposureUsd + shortExposureUsd,
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
        {payload?.warnings.length ? (
          <span title={payload.warnings.join(" · ")}>fuente parcial</span>
        ) : null}
        <label className={styles.thresholdControl}>
          <span>Umbral {threshold.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="0.75"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            aria-label="Umbral mínimo de intensidad"
          />
        </label>
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
            <b>${formatPrice(activeHover.price)}</b>
            <span>{formatTime(activeHover.ts)}</span>
            <div>
              <span>Exposición modelada</span>
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
        Las bandas son una estimación propia basada principalmente en precio, crecimiento de interés
        abierto y escenarios de apalancamiento. Los montos son del modelo y no son comparables 1:1
        con CoinGlass ni representan posiciones individuales publicadas por los exchanges.
      </p>
    </div>
  );
}

function drawMap(
  canvas: HTMLCanvasElement,
  payload: LiquidationMapPayload,
  threshold: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(440, rect.width);
  const height = Math.max(420, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#070a10";
  ctx.fillRect(0, 0, width, height);

  if (!payload.candles.length) {
    ctx.fillStyle = "#758091";
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos históricos suficientes", width / 2, height / 2);
    return;
  }

  const geometry = computeGeometry(payload, width, height);
  drawPlotBackground(ctx, geometry);
  drawGrid(ctx, geometry);
  const grid = buildHeatmapGrid(payload.zones, geometry, payload.hours);
  drawHeatmapGrid(ctx, grid, geometry, threshold);
  drawCandles(ctx, payload.candles, geometry);
  drawAxes(ctx, geometry);
}

function computeGeometry(payload: LiquidationMapPayload, width: number, height: number): Geometry {
  const left = 18;
  const right = width - 62;
  const top = 18;
  const bottom = height - 32;
  const plotWidth = right - left;
  const plotHeight = bottom - top;
  const candles = payload.candles;
  const currentPrice = candles.at(-1)?.close ?? 1;
  const candleLow = Math.min(...candles.map((item) => item.low));
  const candleHigh = Math.max(...candles.map((item) => item.high));
  const targetRatio = payload.hours <= 4 ? 0.03 : payload.hours <= 12 ? 0.04 : 0.052;
  const hardRatio = payload.hours <= 4 ? 0.045 : payload.hours <= 12 ? 0.055 : 0.067;
  const targetLow = currentPrice * (1 - targetRatio);
  const targetHigh = currentPrice * (1 + targetRatio);
  const hardLow = currentPrice * (1 - hardRatio);
  const hardHigh = currentPrice * (1 + hardRatio);
  const minPrice = Math.max(hardLow, Math.min(targetLow, candleLow * 0.996));
  const maxPrice = Math.min(hardHigh, Math.max(targetHigh, candleHigh * 1.004));
  const minTs = candles[0]?.ts ?? Date.now();
  const maxTs = (candles.at(-1)?.ts ?? minTs) + 5 * 60 * 1000;

  return {
    left,
    right,
    top,
    bottom,
    plotWidth,
    plotHeight,
    minPrice,
    maxPrice,
    minTs,
    maxTs,
  };
}

function buildHeatmapGrid(
  zones: EstimatedLiquidationZone[],
  geometry: Geometry,
  hours: number,
): HeatmapGrid {
  const xBins = Math.max(48, Math.round(hours * 12));
  const yBins = Y_BINS;
  const values = new Float64Array(xBins * yBins);
  const duration = Math.max(1, geometry.maxTs - geometry.minTs);
  const priceRange = Math.max(Number.EPSILON, geometry.maxPrice - geometry.minPrice);

  for (const zone of zones) {
    if (zone.price < geometry.minPrice || zone.price > geometry.maxPrice) continue;
    if (zone.endTs < geometry.minTs || zone.startTs > geometry.maxTs) continue;

    const xStart = clampInt(
      Math.floor(((zone.startTs - geometry.minTs) / duration) * xBins),
      0,
      xBins - 1,
    );
    const xEnd = clampInt(
      Math.floor((((zone.endTs + 5 * 60 * 1000) - geometry.minTs) / duration) * xBins),
      xStart,
      xBins - 1,
    );
    const yCenter = clampInt(
      Math.floor(((geometry.maxPrice - zone.price) / priceRange) * yBins),
      0,
      yBins - 1,
    );

    for (let xIndex = xStart; xIndex <= xEnd; xIndex += 1) {
      addCell(values, xBins, yBins, xIndex, yCenter, zone.exposureUsd);
      addCell(values, xBins, yBins, xIndex, yCenter - 1, zone.exposureUsd * 0.34);
      addCell(values, xBins, yBins, xIndex, yCenter + 1, zone.exposureUsd * 0.34);
    }
  }

  const logs = Array.from(values)
    .filter((value) => value > 0)
    .map((value) => Math.log1p(value))
    .sort((a, b) => a - b);
  const lowLog = percentileSorted(logs, 0.2) ?? 0;
  const highLog = percentileSorted(logs, 0.97) ?? Math.max(1, lowLog + 1);

  return { xBins, yBins, values, lowLog, highLog };
}

function addCell(
  values: Float64Array,
  xBins: number,
  yBins: number,
  xIndex: number,
  yIndex: number,
  amount: number,
): void {
  if (xIndex < 0 || xIndex >= xBins || yIndex < 0 || yIndex >= yBins || amount <= 0) return;
  const index = yIndex * xBins + xIndex;
  values[index] = (values[index] ?? 0) + amount;
}

function drawPlotBackground(ctx: CanvasRenderingContext2D, geometry: Geometry): void {
  const gradient = ctx.createLinearGradient(0, geometry.top, 0, geometry.bottom);
  gradient.addColorStop(0, "#3c0750");
  gradient.addColorStop(0.5, "#360648");
  gradient.addColorStop(1, "#300541");
  ctx.fillStyle = gradient;
  ctx.fillRect(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight);
}

function drawHeatmapGrid(
  ctx: CanvasRenderingContext2D,
  grid: HeatmapGrid,
  geometry: Geometry,
  threshold: number,
): void {
  const cellWidth = geometry.plotWidth / grid.xBins;
  const cellHeight = geometry.plotHeight / grid.yBins;
  const spread = Math.max(0.0001, grid.highLog - grid.lowLog);

  for (let yIndex = 0; yIndex < grid.yBins; yIndex += 1) {
    for (let xIndex = 0; xIndex < grid.xBins; xIndex += 1) {
      const value = grid.values[yIndex * grid.xBins + xIndex] ?? 0;
      if (value <= 0) continue;
      const intensity = clamp((Math.log1p(value) - grid.lowLog) / spread, 0, 1);
      if (intensity < threshold) continue;
      ctx.fillStyle = intensityColor(intensity);
      ctx.fillRect(
        geometry.left + xIndex * cellWidth,
        geometry.top + yIndex * cellHeight,
        Math.ceil(cellWidth + 0.4),
        Math.ceil(cellHeight + 0.4),
      );
    }
  }
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  candles: HistoricalCandle[],
  geometry: Geometry,
): void {
  const visible = candles.filter(
    (candle) => candle.ts >= geometry.minTs && candle.ts <= geometry.maxTs,
  );
  const bodyWidth = clamp((geometry.plotWidth / Math.max(visible.length, 1)) * 0.7, 1.4, 5.5);

  for (const candle of visible) {
    const x = timeToX(candle.ts + 2.5 * 60 * 1000, geometry);
    const openY = priceToY(candle.open, geometry);
    const closeY = priceToY(candle.close, geometry);
    const highY = priceToY(candle.high, geometry);
    const lowY = priceToY(candle.low, geometry);
    if (lowY < geometry.top || highY > geometry.bottom) continue;
    const rising = candle.close >= candle.open;
    const color = rising ? "#18d59b" : "#ff4e72";

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
      Math.max(1.3, Math.abs(closeY - openY)),
    );
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, geometry: Geometry): void {
  ctx.strokeStyle = "rgba(255,255,255,.075)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 6; step += 1) {
    const y = geometry.top + (step / 6) * geometry.plotHeight;
    ctx.beginPath();
    ctx.moveTo(geometry.left, y);
    ctx.lineTo(geometry.right, y);
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, geometry: Geometry): void {
  ctx.fillStyle = "#9aa6b5";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "left";
  for (let step = 0; step <= 6; step += 1) {
    const ratio = step / 6;
    const y = geometry.top + ratio * geometry.plotHeight;
    const price = geometry.maxPrice - ratio * (geometry.maxPrice - geometry.minPrice);
    ctx.fillText(formatPrice(price), geometry.right + 7, y + 3);
  }

  const timeSteps = 6;
  for (let step = 0; step <= timeSteps; step += 1) {
    const ratio = step / timeSteps;
    const x = geometry.left + ratio * geometry.plotWidth;
    const timestamp = geometry.minTs + ratio * (geometry.maxTs - geometry.minTs);
    ctx.textAlign = step === 0 ? "left" : step === timeSteps ? "right" : "center";
    ctx.fillText(formatAxisTime(timestamp), x, geometry.bottom + 18);
  }
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
    { p: 0, rgb: [52, 17, 104] },
    { p: 0.26, rgb: [39, 74, 149] },
    { p: 0.5, rgb: [28, 153, 166] },
    { p: 0.74, rgb: [67, 194, 99] },
    { p: 1, rgb: [241, 229, 27] },
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
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.42 + clamped * 0.55})`;
}

function percentileSorted(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const index = Math.floor((values.length - 1) * ratio);
  return values[clampInt(index, 0, values.length - 1)] ?? null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.trunc(clamp(value, minimum, maximum));
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

function exchangeLabel(value: string): string {
  if (value === "okx") return "OKX";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
