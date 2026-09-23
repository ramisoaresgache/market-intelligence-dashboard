"use client";

import { useMemo, useRef, useState, type WheelEvent } from "react";
import type { LiquidityFrame } from "../../lib/market/use-liquidity-history";
import type { LiquidationEvent } from "../../lib/market/types";
import { percentile } from "../../lib/market/engine/visualization";
import { exportSvgAsPng } from "./chart-export";
import { ChartToolbar } from "./chart-toolbar";

const WIDTH = 1080;
const HEIGHT = 430;
const PLOT = { left: 76, right: 28, top: 22, bottom: 48 };

type Props = {
  symbol: string;
  history: LiquidityFrame[];
  liquidations: LiquidationEvent[];
};

export function LiquidityHeatmap({ symbol, history, liquidations }: Props) {
  const [zoom, setZoom] = useState(1);
  const [exportLabel, setExportLabel] = useState("Export PNG");
  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(() => buildModel(history, zoom), [history, zoom]);

  const changeZoom = (direction: number) => {
    setZoom((current) => clamp(Number((current + direction * 0.5).toFixed(1)), 1, 4));
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1 : -1);
  };
  const exportChart = async () => {
    if (!svgRef.current) return;
    setExportLabel("Saving…");
    try {
      await exportSvgAsPng(svgRef.current, `${symbol}-liquidity.png`);
      setExportLabel("PNG ready");
    } catch {
      setExportLabel("Export failed");
    }
  };

  return (
    <section className="chart-card heatmap-card" id="liquidity">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">SESSION LIQUIDITY</span>
          <h2>Liquidity heatmap</h2>
          <p>Visible limit liquidity sampled locally every 2 seconds.</p>
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

      <div className="chart-legend">
        <span><i className="legend-gradient" /> visible notional</span>
        <span><i className="legend-line" /> consolidated mid</span>
        <span><i className="legend-dot liquidation-long" /> long liquidation</span>
        <span><i className="legend-dot liquidation-short" /> short liquidation</span>
        <small>Scroll over chart to zoom</small>
      </div>

      <div className="chart-stage">
        {model ? (
          <svg
            ref={svgRef}
            className="market-chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${symbol} session liquidity heatmap`}
            onWheel={handleWheel}
          >
            <rect width={WIDTH} height={HEIGHT} fill="#070b12" />
            <ChartGrid min={model.minPrice} max={model.maxPrice} start={model.start} end={model.end} />
            <g aria-hidden="true">
              {model.cells.map((cell) => (
                <rect
                  key={cell.key}
                  x={cell.x}
                  y={cell.y}
                  width={cell.width + 0.5}
                  height={cell.height + 0.5}
                  rx="1"
                  fill={heatColor(cell.intensity)}
                >
                  <title>{`${formatPrice(cell.price)} · ${compactMoney(cell.notional)}`}</title>
                </rect>
              ))}
              <polyline points={model.midLine} fill="none" stroke="#f05a83" strokeWidth="2.2" />
              {liquidations
                .filter((event) => event.ts >= model.start && event.ts <= model.end)
                .map((event, index) => {
                  const x = scale(event.ts, model.start, model.end, PLOT.left, WIDTH - PLOT.right);
                  const y = scale(event.price, model.maxPrice, model.minPrice, PLOT.top, HEIGHT - PLOT.bottom);
                  return (
                    <circle
                      key={`${event.exchange}-${event.ts}-${index}`}
                      cx={x}
                      cy={y}
                      r={Math.min(8, 3 + Math.log10(Math.max(1, event.notional)) / 2)}
                      fill={event.side === "long" ? "#ff4f72" : "#2ee6a6"}
                      stroke="#071018"
                      strokeWidth="2"
                    >
                      <title>{`${event.side.toUpperCase()} · ${compactMoney(event.notional)} · ${event.exchange}`}</title>
                    </circle>
                  );
                })}
            </g>
            <AxisLabels min={model.minPrice} max={model.maxPrice} start={model.start} end={model.end} />
          </svg>
        ) : (
          <div className="chart-empty">
            <span className="pulse-ring" />
            <strong>Building local history</strong>
            <p>The heatmap appears after the first two live samples.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function buildModel(history: LiquidityFrame[], zoom: number) {
  if (history.length < 2) return null;
  const frameCount = Math.max(2, Math.ceil(history.length / zoom));
  const frames = history.slice(-frameCount);
  const center = frames.at(-1)?.mid ?? 0;
  const rawPrices = frames.flatMap((frame) => frame.levels.map((level) => level.price));
  const rawMin = Math.min(...rawPrices, center);
  const rawMax = Math.max(...rawPrices, center);
  const halfRange = Math.max(center * 0.0005, (rawMax - rawMin) / (2 * zoom));
  const minPrice = center - halfRange;
  const maxPrice = center + halfRange;
  const start = frames[0].ts;
  const end = frames.at(-1)?.ts ?? start + 1;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const frameWidth = plotWidth / Math.max(1, frames.length - 1);
  const visible = frames.flatMap((frame) =>
    frame.levels.filter((level) => level.price >= minPrice && level.price <= maxPrice),
  );
  const notionals = visible.flatMap((level) => [level.bidNotional, level.askNotional]).filter(Boolean);
  const ceiling = Math.max(1, percentile(notionals, 0.95));
  const prices = [...new Set(visible.map((level) => level.price))].sort((a, b) => a - b);
  const rowHeight = Math.max(2, Math.min(11, plotHeight / Math.max(prices.length, 1)));
  const cells = frames.flatMap((frame, frameIndex) =>
    frame.levels
      .filter((level) => level.price >= minPrice && level.price <= maxPrice)
      .map((level) => {
        const notional = level.bidNotional + level.askNotional;
        return {
          key: `${frame.ts}-${level.price}`,
          x: PLOT.left + frameIndex * frameWidth,
          y: scale(level.price, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom) - rowHeight / 2,
          width: frameWidth,
          height: rowHeight,
          price: level.price,
          notional,
          intensity: Math.min(1, Math.log1p(notional) / Math.log1p(ceiling)),
        };
      }),
  );
  const midLine = frames
    .map((frame, index) => {
      const x = PLOT.left + index * frameWidth;
      const y = scale(frame.mid, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom);
      return `${x},${y}`;
    })
    .join(" ");
  return { cells, midLine, minPrice, maxPrice, start, end };
}

function ChartGrid({ min, max, start, end }: { min: number; max: number; start: number; end: number }) {
  return (
    <g>
      {Array.from({ length: 6 }, (_, index) => {
        const y = PLOT.top + ((HEIGHT - PLOT.top - PLOT.bottom) * index) / 5;
        return <line key={`h-${index}`} x1={PLOT.left} y1={y} x2={WIDTH - PLOT.right} y2={y} stroke="#172333" />;
      })}
      {Array.from({ length: 7 }, (_, index) => {
        const x = PLOT.left + ((WIDTH - PLOT.left - PLOT.right) * index) / 6;
        return <line key={`v-${index}`} x1={x} y1={PLOT.top} x2={x} y2={HEIGHT - PLOT.bottom} stroke="#13202f" strokeDasharray="3 7" />;
      })}
      <text x={PLOT.left} y={16} fill="#617086" fontSize="10">{formatPrice(max)} high</text>
      <text x={WIDTH - PLOT.right} y={16} textAnchor="end" fill="#617086" fontSize="10">
        {Math.max(1, Math.round((end - start) / 1000))}s session window
      </text>
    </g>
  );
}

function AxisLabels({ min, max, start, end }: { min: number; max: number; start: number; end: number }) {
  return (
    <g fill="#7b8a9f" fontSize="10" fontFamily="ui-monospace, monospace">
      {Array.from({ length: 6 }, (_, index) => {
        const ratio = index / 5;
        const y = PLOT.top + (HEIGHT - PLOT.top - PLOT.bottom) * ratio;
        return <text key={index} x={PLOT.left - 10} y={y + 3} textAnchor="end">{formatPrice(max - (max - min) * ratio)}</text>;
      })}
      {Array.from({ length: 4 }, (_, index) => {
        const ratio = index / 3;
        const x = PLOT.left + (WIDTH - PLOT.left - PLOT.right) * ratio;
        return <text key={index} x={x} y={HEIGHT - 17} textAnchor={index === 0 ? "start" : index === 3 ? "end" : "middle"}>{time(start + (end - start) * ratio)}</text>;
      })}
      <text x={17} y={HEIGHT / 2} transform={`rotate(-90 17 ${HEIGHT / 2})`} textAnchor="middle" fill="#536176">PRICE (USDT)</text>
      <text x={(PLOT.left + WIDTH - PLOT.right) / 2} y={HEIGHT - 2} textAnchor="middle" fill="#536176">LOCAL SESSION TIME</text>
    </g>
  );
}

function heatColor(value: number): string {
  if (value > 0.82) return `rgba(255, 221, 86, ${0.65 + value * 0.35})`;
  if (value > 0.55) return `rgba(20, 205, 222, ${0.32 + value * 0.45})`;
  return `rgba(17, 106, 165, ${0.08 + value * 0.52})`;
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
