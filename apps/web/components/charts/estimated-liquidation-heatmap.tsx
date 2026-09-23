"use client";

import { useMemo, useRef, useState, type WheelEvent } from "react";
import {
  decayedExposure,
  type DerivativesSample,
  type EstimatedLiquidationZone,
} from "../../lib/market/engine/estimated-liquidations";
import { percentile } from "../../lib/market/engine/visualization";
import type { LiquidationEvent } from "../../lib/market/types";
import type { HistoricalCandle } from "../../lib/market/use-historical-liquidation-map";
import { exportSvgAsPng } from "./chart-export";
import { ChartToolbar } from "./chart-toolbar";

const WIDTH = 1200;
const HEIGHT = 630;
const PLOT = { left: 104, right: 72, top: 34, bottom: 112 };
const PLOT_RIGHT = WIDTH - PLOT.right;
const PLOT_BOTTOM = HEIGHT - PLOT.bottom;

type Props = {
  symbol: string;
  samples: DerivativesSample[];
  candles: HistoricalCandle[];
  zones: EstimatedLiquidationZone[];
  observed: LiquidationEvent[];
  historyState: "loading" | "live" | "unavailable";
};

export function EstimatedLiquidationHeatmap({ symbol, samples, candles, zones, observed, historyState }: Props) {
  const [zoom, setZoom] = useState(1);
  const [threshold, setThreshold] = useState(0.2);
  const [rangeHours, setRangeHours] = useState<4 | 12 | 24>(24);
  const [exportLabel, setExportLabel] = useState("Export PNG");
  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(
    () => buildModel(samples, candles, zones, observed, zoom, threshold, rangeHours),
    [samples, candles, zones, observed, zoom, threshold, rangeHours],
  );
  const changeZoom = (direction: number) => {
    setZoom((current) => clamp(Number((current + direction * 0.5).toFixed(1)), 1, 4));
  };
  const exportChart = async () => {
    if (!svgRef.current) return;
    setExportLabel("Saving…");
    try {
      await exportSvgAsPng(svgRef.current, `${symbol}-estimated-liquidations.png`);
      setExportLabel("PNG ready");
    } catch {
      setExportLabel("Export failed");
    }
  };

  return (
    <section className="chart-card liquidation-map-card" id="estimated-liquidations">
      <div className="panel-heading liquidation-map-heading">
        <div>
          <span className="section-kicker">MAPA DE LIQUIDACIONES ESTIMADAS</span>
          <h2>Zonas donde podría concentrarse el riesgo de liquidación</h2>
          <p>Las bandas estiman exposición por nivel de precio. Las velas históricas se dibujan encima para conservar el contexto real del mercado.</p>
        </div>
        <div className="map-heading-controls">
          <span className="market-chip">{symbol.replace("USDT", "/USDT")} PERPETUAL</span>
          <div className="time-range-control" aria-label="Historical time range">
            {([4, 12, 24] as const).map((hours) => (
              <button key={hours} type="button" className={rangeHours === hours ? "active" : ""} onClick={() => setRangeHours(hours)}>{hours} h</button>
            ))}
          </div>
          <ChartToolbar
            zoom={zoom}
            onZoomIn={() => changeZoom(1)}
            onZoomOut={() => changeZoom(-1)}
            onReset={() => setZoom(1)}
            onExport={() => void exportChart()}
            exportLabel={exportLabel}
          />
        </div>
      </div>
      <div className="chart-legend liquidation-map-legend">
        <span className="model-badge">ESTIMADO</span>
        <span>{rangeHours} H HISTÓRICAS</span>
        <span><i className="liquidation-scale" /> zonas estimadas</span>
        <span><i className="candle-key up" /> velas reales Binance</span>
        <span className={`history-state ${historyState}`}>{historyState === "live" ? "HISTORIAL LIVE" : historyState === "loading" ? "CARGANDO HISTORIAL" : "HISTORIAL NO DISPONIBLE"}</span>
        <label className="threshold-control">
          UMBRAL
          <input
            aria-label="Liquidation heatmap threshold"
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <b>{Math.round(threshold * 100)}%</b>
        </label>
      </div>
      <div className="chart-stage liquidation-map-stage">
        {model ? (
          <svg
            ref={svgRef}
            className="market-chart liquidation-chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${symbol} estimated liquidation heatmap with price candles`}
            onWheel={(event: WheelEvent<SVGSVGElement>) => {
              event.preventDefault();
              changeZoom(event.deltaY < 0 ? 1 : -1);
            }}
          >
            <defs>
              <linearGradient id="liquidationScaleVertical" x1="0" x2="0" y1="1" y2="0">
                <stop stopColor="#43105d" />
                <stop offset=".32" stopColor="#226b91" />
                <stop offset=".66" stopColor="#32c979" />
                <stop offset="1" stopColor="#f5ec18" />
              </linearGradient>
              <linearGradient id="navigatorFill" x1="0" x2="0" y1="0" y2="1">
                <stop stopColor="#6686bd" stopOpacity=".42" />
                <stop offset="1" stopColor="#263c63" stopOpacity=".12" />
              </linearGradient>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="#03070c" />
            <rect x={PLOT.left} y={PLOT.top} width={PLOT_RIGHT - PLOT.left} height={PLOT_BOTTOM - PLOT.top} fill="#300548" />
            <Grid />
            <IntensityScale maxExposure={model.maxExposure} />
            <g aria-label="Estimated liquidation level bands" aria-hidden="true">
              {model.bands.map((band) => (
                <rect
                  key={band.id}
                  x={band.x}
                  y={band.y}
                  width={band.width}
                  height={band.height}
                  rx="1"
                  fill={liquidationColor(band.intensity)}
                  opacity={0.28 + band.intensity * 0.72}
                >
                  <title>{`${band.side.toUpperCase()} ${band.leverage}x estimate · level ${formatPrice(band.price)} · modeled ${compactMoney(band.exposure)}`}</title>
                </rect>
              ))}
            </g>
            <g aria-label="Live mark-price candles" aria-hidden="true">
              {model.candles.map((candle) => (
                <g key={candle.key}>
                  <line x1={candle.x} y1={candle.highY} x2={candle.x} y2={candle.lowY} stroke={candle.up ? "#20e6a3" : "#ff4778"} strokeWidth="1.4" />
                  <rect
                    x={candle.x - candle.width / 2}
                    y={candle.bodyY}
                    width={candle.width}
                    height={candle.bodyHeight}
                    fill={candle.up ? "#20e6a3" : "#ff4778"}
                    rx=".7"
                  >
                    <title>{`${time(candle.ts)} · O ${formatPrice(candle.open)} H ${formatPrice(candle.high)} L ${formatPrice(candle.low)} C ${formatPrice(candle.close)}`}</title>
                  </rect>
                </g>
              ))}
            </g>
            <g aria-label="Observed exchange liquidations">
              {model.observed.map((event) => (
                <circle
                  key={event.key}
                  cx={event.x}
                  cy={event.y}
                  r={event.radius}
                  fill={event.side === "long" ? "#ff345f" : "#13e9ad"}
                  stroke="#070a10"
                  strokeWidth="2"
                >
                  <title>{`OBSERVED ${event.side.toUpperCase()} · ${compactMoney(event.notional)} · ${event.exchange}`}</title>
                </circle>
              ))}
            </g>
            <CurrentPriceMarker price={model.lastPrice} y={model.lastPriceY} />
            <Axis model={model} />
            <Navigator model={model} />
          </svg>
        ) : (
          <div className="chart-empty liquidation-chart-empty">
            <span className="pulse-ring" />
            <strong>Building the session liquidation map</strong>
            <p>Price candles appear first. Estimated levels are added when increases in open interest are observed.</p>
          </div>
        )}
      </div>
      <div className="model-disclaimer">
        <b>NIVELES ESTIMADOS</b>
        <span>Las velas son datos históricos reales de Binance USD-M. Las bandas son un modelo propio basado en cambios de interés abierto, precio y escenarios de apalancamiento; no representan posiciones individuales publicadas por los exchanges.</span>
      </div>
    </section>
  );
}

function buildModel(
  samples: DerivativesSample[],
  historicalCandles: HistoricalCandle[],
  zones: EstimatedLiquidationZone[],
  observed: LiquidationEvent[],
  zoom: number,
  threshold: number,
  rangeHours: 4 | 12 | 24,
) {
  const sourceCandles = historicalCandles.length >= 2
    ? historicalCandles
    : sessionCandles(samples);
  if (sourceCandles.length < 2) return null;
  const end = sourceCandles.at(-1)?.closeTime ?? Date.now();
  const start = end - (rangeHours * 60 * 60 * 1_000) / zoom;
  const visibleHistory = sourceCandles.filter((candle) => candle.closeTime >= start);
  if (visibleHistory.length < 2) return null;
  const lastPrice = samples.at(-1)?.price ?? visibleHistory.at(-1)?.close ?? 0;
  const rangeRatio = 0.055 / Math.sqrt(zoom);
  const minPrice = Math.min(
    lastPrice * (1 - rangeRatio),
    ...visibleHistory.map((candle) => candle.low),
  );
  const maxPrice = Math.max(
    lastPrice * (1 + rangeRatio),
    ...visibleHistory.map((candle) => candle.high),
  );
  const plotHeight = PLOT_BOTTOM - PLOT.top;
  const candidates = zones.filter(
    (zone) => zone.createdAt >= start && zone.createdAt <= end && zone.liquidationPrice >= minPrice && zone.liquidationPrice <= maxPrice,
  );
  const halfLife = rangeHours * 60 * 60 * 1_000;
  const exposures = candidates.map((zone) => decayedExposure(zone, end, halfLife));
  const ceiling = Math.max(1, percentile(exposures, 0.92));
  const rowHeight = Math.max(4, Math.min(9, plotHeight / 64));
  const bands = candidates.map((zone) => {
    const exposure = decayedExposure(zone, end, halfLife);
    const intensity = Math.min(1, (exposure / ceiling) ** 0.55);
    const x = scale(Math.max(start, zone.createdAt), start, end, PLOT.left, PLOT_RIGHT);
    return {
      id: zone.id,
      x,
      y: scale(zone.liquidationPrice, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM) - rowHeight / 2,
      width: Math.max(2, PLOT_RIGHT - x),
      height: rowHeight,
      price: zone.liquidationPrice,
      side: zone.side,
      leverage: zone.leverage,
      exposure,
      intensity,
    };
  }).filter((band) => band.intensity >= threshold).sort((left, right) => left.intensity - right.intensity);
  const candles = positionCandles(visibleHistory, minPrice, maxPrice, start, end);
  const observedPoints = observed
    .filter((event) => event.ts >= start && event.ts <= end && event.price >= minPrice && event.price <= maxPrice)
    .map((event, index) => ({
      ...event,
      key: `${event.exchange}-${event.ts}-${index}`,
      x: scale(event.ts, start, end, PLOT.left, PLOT_RIGHT),
      y: scale(event.price, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM),
      radius: Math.min(9, 3 + Math.log10(Math.max(1, event.notional)) / 2),
    }));
  const navigatorPoints = visibleHistory.map((candle, index) => {
    const x = PLOT.left + ((PLOT_RIGHT - PLOT.left) * index) / Math.max(1, visibleHistory.length - 1);
    const y = scale(candle.close, maxPrice, minPrice, HEIGHT - 64, HEIGHT - 22);
    return `${x},${y}`;
  }).join(" ");
  return {
    bands,
    candles,
    observed: observedPoints,
    navigatorPoints,
    minPrice,
    maxPrice,
    start,
    end,
    lastPrice,
    lastPriceY: scale(lastPrice, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM),
    maxExposure: Math.max(0, ...exposures),
  };
}

type ChartModel = NonNullable<ReturnType<typeof buildModel>>;

function positionCandles(
  candles: HistoricalCandle[],
  minPrice: number,
  maxPrice: number,
  start: number,
  end: number,
) {
  const candleWidth = Math.max(2, Math.min(9, ((PLOT_RIGHT - PLOT.left) / Math.max(1, candles.length)) * 0.68));
  return candles.map((candle, index) => {
    const openY = scale(candle.open, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM);
    const closeY = scale(candle.close, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM);
    return {
      key: `${candle.openTime}-${index}`,
      ts: candle.openTime,
      x: scale(candle.openTime, start, end, PLOT.left, PLOT_RIGHT),
      open: candle.open,
      close: candle.close,
      high: candle.high,
      low: candle.low,
      highY: scale(candle.high, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM),
      lowY: scale(candle.low, maxPrice, minPrice, PLOT.top, PLOT_BOTTOM),
      bodyY: Math.min(openY, closeY),
      bodyHeight: Math.max(2, Math.abs(closeY - openY)),
      width: candleWidth,
      up: candle.close >= candle.open,
    };
  });
}

function sessionCandles(samples: DerivativesSample[]): HistoricalCandle[] {
  return samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    return {
      openTime: previous.ts,
      closeTime: sample.ts,
      open: previous.price,
      high: Math.max(previous.price, sample.price),
      low: Math.min(previous.price, sample.price),
      close: sample.price,
    };
  });
}

function Grid() {
  return <g>{Array.from({ length: 7 }, (_, index) => {
    const y = PLOT.top + ((PLOT_BOTTOM - PLOT.top) * index) / 6;
    return <line key={`h-${index}`} x1={PLOT.left} y1={y} x2={PLOT_RIGHT} y2={y} stroke="#5b176d" opacity=".45" />;
  })}{Array.from({ length: 9 }, (_, index) => {
    const x = PLOT.left + ((PLOT_RIGHT - PLOT.left) * index) / 8;
    return <line key={`v-${index}`} x1={x} y1={PLOT.top} x2={x} y2={PLOT_BOTTOM} stroke="#502060" strokeDasharray="3 7" opacity=".4" />;
  })}<text x={PLOT.left} y="21" fill="#8f7aa3" fontSize="10">VELAS HISTÓRICAS + CONCENTRACIÓN ESTIMADA</text></g>;
}

function IntensityScale({ maxExposure }: { maxExposure: number }) {
  return <g fontFamily="ui-monospace, monospace" fontSize="9">
    <rect x="30" y={PLOT.top + 28} width="22" height={PLOT_BOTTOM - PLOT.top - 56} rx="4" fill="url(#liquidationScaleVertical)" />
    <text x="41" y={PLOT.top + 16} textAnchor="middle" fill="#9b8ba9">{compactMoney(maxExposure)}</text>
    <text x="41" y={PLOT_BOTTOM - 8} textAnchor="middle" fill="#75677f">0</text>
    <text x="17" y={(PLOT.top + PLOT_BOTTOM) / 2} transform={`rotate(-90 17 ${(PLOT.top + PLOT_BOTTOM) / 2})`} textAnchor="middle" fill="#776681">EXPOSICIÓN ESTIMADA</text>
  </g>;
}

function CurrentPriceMarker({ price, y }: { price: number; y: number }) {
  return <g>
    <line x1={PLOT.left} y1={y} x2={PLOT_RIGHT} y2={y} stroke="#ff4f89" strokeWidth="1" strokeDasharray="4 4" opacity=".75" />
    <rect x={PLOT_RIGHT + 4} y={y - 10} width="64" height="20" rx="3" fill="#ff4f89" />
    <text x={PLOT_RIGHT + 62} y={y + 4} textAnchor="end" fill="#16040a" fontSize="9" fontWeight="800">{formatPrice(price)}</text>
  </g>;
}

function Axis({ model }: { model: ChartModel }) {
  return <g fill="#a090ad" fontSize="10" fontFamily="ui-monospace, monospace">
    {Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      const y = PLOT.top + (PLOT_BOTTOM - PLOT.top) * ratio;
      return <text key={`p-${index}`} x={PLOT_RIGHT + 8} y={y + 3}>{formatPrice(model.maxPrice - (model.maxPrice - model.minPrice) * ratio)}</text>;
    })}
    {Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      const x = PLOT.left + (PLOT_RIGHT - PLOT.left) * ratio;
      return <text key={`t-${index}`} x={x} y={PLOT_BOTTOM + 24} textAnchor={index === 0 ? "start" : index === 6 ? "end" : "middle"}>{time(model.start + (model.end - model.start) * ratio)}</text>;
    })}
  </g>;
}

function Navigator({ model }: { model: ChartModel }) {
  const area = `${PLOT.left},${HEIGHT - 20} ${model.navigatorPoints} ${PLOT_RIGHT},${HEIGHT - 20}`;
  return <g>
    <rect x={PLOT.left} y={HEIGHT - 68} width={PLOT_RIGHT - PLOT.left} height="50" rx="3" fill="#111c33" stroke="#273759" />
    <polygon points={area} fill="url(#navigatorFill)" />
    <polyline points={model.navigatorPoints} fill="none" stroke="#7595ca" strokeWidth="1.2" />
    <rect x={PLOT.left} y={HEIGHT - 68} width="8" height="50" rx="3" fill="#34435d" />
    <rect x={PLOT_RIGHT - 8} y={HEIGHT - 68} width="8" height="50" rx="3" fill="#34435d" />
  </g>;
}

function liquidationColor(value: number): string {
  if (value > 0.84) return "#f5ec18";
  if (value > 0.62) return "#59d445";
  if (value > 0.4) return "#22b99a";
  if (value > 0.22) return "#2686a5";
  return "#315484";
}

function scale(value: number, min: number, max: number, start: number, end: number): number {
  if (min === max) return (start + end) / 2;
  return start + ((value - min) / (max - min)) * (end - start);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatPrice(value: number): string {
  return value >= 1000 ? value.toFixed(1) : value.toFixed(3);
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function time(value: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}
