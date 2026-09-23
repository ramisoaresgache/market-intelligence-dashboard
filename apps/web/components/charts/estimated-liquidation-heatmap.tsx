"use client";

import { useMemo, useRef, useState, type WheelEvent } from "react";
import {
  decayedExposure,
  type DerivativesSample,
  type EstimatedLiquidationZone,
} from "../../lib/market/engine/estimated-liquidations";
import { percentile } from "../../lib/market/engine/visualization";
import type { LiquidationEvent } from "../../lib/market/types";
import { exportSvgAsPng } from "./chart-export";
import { ChartToolbar } from "./chart-toolbar";

const WIDTH = 1120;
const HEIGHT = 500;
const PLOT = { left: 82, right: 34, top: 30, bottom: 54 };

type Props = {
  symbol: string;
  samples: DerivativesSample[];
  zones: EstimatedLiquidationZone[];
  observed: LiquidationEvent[];
};

export function EstimatedLiquidationHeatmap({ symbol, samples, zones, observed }: Props) {
  const [zoom, setZoom] = useState(1);
  const [exportLabel, setExportLabel] = useState("Export PNG");
  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(
    () => buildModel(samples, zones, observed, zoom),
    [samples, zones, observed, zoom],
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
      <div className="panel-heading">
        <div>
          <span className="section-kicker">MODELED DERIVATIVES RISK</span>
          <h2>Estimated liquidation heatmap <span className="model-badge">ESTIMATED</span></h2>
          <p>Potential leverage liquidation zones inferred from session OI, funding and price—not exact trader positions.</p>
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
      <div className="chart-legend liquidation-map-legend">
        <span><i className="liquidation-scale" /> modeled exposure</span>
        <span><i className="legend-line" /> mark price</span>
        <span><i className="legend-dot liquidation-long" /> observed long liquidation</span>
        <span><i className="legend-dot liquidation-short" /> observed short liquidation</span>
        <small>3x · 5x · 10x · 20x · 50x · 100x model</small>
      </div>
      <div className="chart-stage liquidation-map-stage">
        {model ? (
          <svg
            ref={svgRef}
            className="market-chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${symbol} estimated liquidation heatmap`}
            onWheel={(event: WheelEvent<SVGSVGElement>) => {
              event.preventDefault();
              changeZoom(event.deltaY < 0 ? 1 : -1);
            }}
          >
            <defs>
              <linearGradient id="liquidationScale" x1="0" x2="1">
                <stop stopColor="#43105d" />
                <stop offset=".35" stopColor="#256b8f" />
                <stop offset=".7" stopColor="#31bc75" />
                <stop offset="1" stopColor="#f5ec18" />
              </linearGradient>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="#05070d" />
            <rect
              x={PLOT.left}
              y={PLOT.top}
              width={WIDTH - PLOT.left - PLOT.right}
              height={HEIGHT - PLOT.top - PLOT.bottom}
              fill="#26053f"
              opacity=".78"
            />
            <Grid model={model} />
            <g aria-hidden="true">
              {model.bands.map((band) => (
                <rect
                  key={band.id}
                  x={band.x}
                  y={band.y}
                  width={band.width}
                  height={band.height}
                  rx="1"
                  fill={liquidationColor(band.intensity)}
                  opacity={0.25 + band.intensity * 0.72}
                >
                  <title>{`${band.side.toUpperCase()} ${band.leverage}x estimate · ${formatPrice(band.price)} · modeled ${compactMoney(band.exposure)}`}</title>
                </rect>
              ))}
              <polyline points={model.priceLine} fill="none" stroke="#ff4f89" strokeWidth="2" />
              {model.observed.map((event) => (
                <circle
                  key={event.key}
                  cx={event.x}
                  cy={event.y}
                  r={event.radius}
                  fill={event.side === "long" ? "#ff4f72" : "#2ee6a6"}
                  stroke="#060810"
                  strokeWidth="2"
                >
                  <title>{`OBSERVED ${event.side.toUpperCase()} · ${compactMoney(event.notional)} · ${event.exchange}`}</title>
                </circle>
              ))}
            </g>
            <Axis model={model} />
          </svg>
        ) : (
          <div className="chart-empty">
            <span className="pulse-ring" />
            <strong>Building the session model</strong>
            <p>Zones appear after open interest increases are observed. No synthetic positions are prefilled.</p>
          </div>
        )}
      </div>
      <div className="model-disclaimer">
        <b>MODELED, NOT EXCHANGE POSITIONS</b>
        <span>Public APIs do not reveal each trader&apos;s entry or leverage. Intensity is a relative session estimate and decays over time.</span>
      </div>
    </section>
  );
}

function buildModel(
  samples: DerivativesSample[],
  zones: EstimatedLiquidationZone[],
  observed: LiquidationEvent[],
  zoom: number,
) {
  if (samples.length < 2) return null;
  const sampleCount = Math.max(2, Math.ceil(samples.length / zoom));
  const visibleSamples = samples.slice(-sampleCount);
  const end = visibleSamples.at(-1)?.ts ?? Date.now();
  const start = visibleSamples[0].ts;
  const center = visibleSamples.at(-1)?.price ?? 0;
  const rangeRatio = 0.12 / zoom;
  const minPrice = center * (1 - rangeRatio);
  const maxPrice = center * (1 + rangeRatio);
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const candidates = zones.filter(
    (zone) => zone.createdAt <= end && zone.liquidationPrice >= minPrice && zone.liquidationPrice <= maxPrice,
  );
  const exposures = candidates.map((zone) => decayedExposure(zone, end));
  const ceiling = Math.max(1, percentile(exposures, 0.92));
  const rowHeight = Math.max(4, Math.min(12, plotHeight / 55));
  const bands = candidates.map((zone) => {
    const exposure = decayedExposure(zone, end);
    const x = scale(Math.max(start, zone.createdAt), start, end, PLOT.left, WIDTH - PLOT.right);
    return {
      id: zone.id,
      x,
      y: scale(zone.liquidationPrice, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom) - rowHeight / 2,
      width: Math.max(2, WIDTH - PLOT.right - x),
      height: rowHeight,
      price: zone.liquidationPrice,
      side: zone.side,
      leverage: zone.leverage,
      exposure,
      intensity: Math.min(1, (exposure / ceiling) ** 0.55),
    };
  });
  const priceLine = visibleSamples.map((sample, index) => {
    const x = PLOT.left + (plotWidth * index) / Math.max(1, visibleSamples.length - 1);
    const y = scale(sample.price, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom);
    return `${x},${y}`;
  }).join(" ");
  const observedPoints = observed
    .filter((event) => event.ts >= start && event.ts <= end && event.price >= minPrice && event.price <= maxPrice)
    .map((event, index) => ({
      ...event,
      key: `${event.exchange}-${event.ts}-${index}`,
      x: scale(event.ts, start, end, PLOT.left, WIDTH - PLOT.right),
      y: scale(event.price, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom),
      radius: Math.min(8, 3 + Math.log10(Math.max(1, event.notional)) / 2),
    }));
  return { bands, priceLine, observed: observedPoints, minPrice, maxPrice, start, end };
}

type ChartModel = NonNullable<ReturnType<typeof buildModel>>;

function Grid({ model }: { model: ChartModel }) {
  return <g>{Array.from({ length: 7 }, (_, index) => {
    const y = PLOT.top + ((HEIGHT - PLOT.top - PLOT.bottom) * index) / 6;
    return <line key={`h-${index}`} x1={PLOT.left} y1={y} x2={WIDTH - PLOT.right} y2={y} stroke="#542068" opacity=".55" />;
  })}{Array.from({ length: 7 }, (_, index) => {
    const x = PLOT.left + ((WIDTH - PLOT.left - PLOT.right) * index) / 6;
    return <line key={`v-${index}`} x1={x} y1={PLOT.top} x2={x} y2={HEIGHT - PLOT.bottom} stroke="#512060" strokeDasharray="3 7" opacity=".45" />;
  })}<text x={PLOT.left} y="19" fill="#8f7aa3" fontSize="10">Relative modeled intensity · session only</text></g>;
}

function Axis({ model }: { model: ChartModel }) {
  return <g fill="#9589a6" fontSize="10" fontFamily="ui-monospace, monospace">
    {Array.from({ length: 7 }, (_, index) => {
      const ratio = index / 6;
      const y = PLOT.top + (HEIGHT - PLOT.top - PLOT.bottom) * ratio;
      return <text key={`p-${index}`} x={PLOT.left - 10} y={y + 3} textAnchor="end">{formatPrice(model.maxPrice - (model.maxPrice - model.minPrice) * ratio)}</text>;
    })}
    {Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const x = PLOT.left + (WIDTH - PLOT.left - PLOT.right) * ratio;
      return <text key={`t-${index}`} x={x} y={HEIGHT - 19} textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"}>{time(model.start + (model.end - model.start) * ratio)}</text>;
    })}
    <text x="18" y={HEIGHT / 2} transform={`rotate(-90 18 ${HEIGHT / 2})`} textAnchor="middle" fill="#6f627e">ESTIMATED LIQUIDATION PRICE (USDT)</text>
    <text x={(PLOT.left + WIDTH - PLOT.right) / 2} y={HEIGHT - 3} textAnchor="middle" fill="#6f627e">LOCAL SESSION TIME</text>
  </g>;
}

function liquidationColor(value: number): string {
  if (value > 0.82) return "#f5ec18";
  if (value > 0.58) return "#42ca62";
  if (value > 0.32) return "#2695a6";
  return "#245887";
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
