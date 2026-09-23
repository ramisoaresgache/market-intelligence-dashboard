"use client";

import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { LiquidityFrame } from "../../lib/market/use-liquidity-history";
import type { HistoricalCandle } from "../../lib/market/use-historical-liquidation-map";
import { percentile } from "../../lib/market/engine/visualization";
import { exportSvgAsPng } from "./chart-export";
import { ChartToolbar } from "./chart-toolbar";

const WIDTH = 1120;
const HEIGHT = 500;
const PLOT = { left: 76, right: 270, top: 28, bottom: 52 };
const BASE_HALF_RANGE_RATIO = 0.0025;
const RANGE_OPTIONS = [15, 60, 240] as const;

type Props = {
  symbol: string;
  history: LiquidityFrame[];
  candles: HistoricalCandle[];
};

export function LiquidityHeatmap({ symbol, history, candles }: Props) {
  const [zoom, setZoom] = useState(1);
  const [rangeMinutes, setRangeMinutes] = useState<(typeof RANGE_OPTIONS)[number]>(240);
  const [pan, setPan] = useState({ timeMs: 0, price: 0 });
  const [exportLabel, setExportLabel] = useState("Export PNG");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; panTime: number; panPrice: number; priceSpan: number } | null>(null);
  const model = useMemo(() => buildModel(history, candles, zoom, rangeMinutes, pan), [history, candles, zoom, rangeMinutes, pan]);

  const changeZoom = (direction: number) => {
    setZoom((current) => clamp(Number((current + direction * 0.5).toFixed(1)), 1, 4));
  };
  const resetView = () => { setZoom(1); setPan({ timeMs: 0, price: 0 }); };
  const selectRange = (minutes: (typeof RANGE_OPTIONS)[number]) => {
    setRangeMinutes(minutes);
    resetView();
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1 : -1);
  };
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!model) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panTime: pan.timeMs, panPrice: pan.price, priceSpan: model.maxPrice - model.minPrice };
  };
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !model) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - drag.x) * (WIDTH / rect.width);
    const dy = (event.clientY - drag.y) * (HEIGHT / rect.height);
    const duration = model.end - model.start;
    setPan({
      timeMs: drag.panTime - (dx / (WIDTH - PLOT.left - PLOT.right)) * duration,
      price: drag.panPrice + (dy / (HEIGHT - PLOT.top - PLOT.bottom)) * drag.priceSpan,
    });
  };
  const stopDragging = (event: PointerEvent<SVGSVGElement>) => {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
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
          <span className="section-kicker">REAL EXCHANGE ORDER BOOKS</span>
          <h2>Order book liquidity heatmap</h2>
          <p>Cloudflare history plus 160 live price levels nearest the market from Binance + Bybit.</p>
        </div>
        <div className="orderbook-heading-controls">
          <div className="time-range-control" aria-label="Order book time range">
            {RANGE_OPTIONS.map((minutes) => <button key={minutes} type="button" className={rangeMinutes === minutes ? "active" : ""} onClick={() => selectRange(minutes)}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}
          </div>
          <ChartToolbar zoom={zoom} onZoomIn={() => changeZoom(1)} onZoomOut={() => changeZoom(-1)} onReset={resetView} onExport={() => void exportChart()} exportLabel={exportLabel} />
        </div>
      </div>

      <div className="chart-legend">
        <span><i className="legend-gradient" /> order size: blue lower · cyan medium · yellow larger</span>
        <span><i className="candle-key up" /> price candles</span>
        <span><i className="legend-bar bid-bar" /> current bids</span>
        <span><i className="legend-bar ask-bar" /> current asks</span>
        <small>Drag to move · wheel or − / + to zoom</small>
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <rect width={WIDTH} height={HEIGHT} fill="#070b12" />
            <rect x={PLOT.left} y={PLOT.top} width={WIDTH - PLOT.left - PLOT.right} height={HEIGHT - PLOT.top - PLOT.bottom} fill="#071625" />
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
              {model.candles.map((candle) => (
                <g key={`candle-${candle.ts}`}>
                  <line x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} stroke={candle.up ? "#2ee6aa" : "#ff5377"} strokeWidth="1.2" />
                  <rect x={candle.x - candle.width / 2} y={candle.bodyY} width={candle.width} height={candle.bodyHeight} fill={candle.up ? "#2ee6aa" : "#ff5377"} rx=".7" />
                </g>
              ))}
              {model.currentPriceY !== null ? <>
                <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={model.currentPriceY} y2={model.currentPriceY} stroke="#67deea" strokeWidth="1.2" strokeDasharray="7 5" opacity=".95" />
                <rect x={WIDTH - PLOT.right - 66} y={model.currentPriceY - 9} width="66" height="18" rx="3" fill="#123a47" stroke="#67deea" strokeWidth=".7" />
                <text x={WIDTH - PLOT.right - 5} y={model.currentPriceY + 3} textAnchor="end" fill="#bff9ff" fontSize="8" fontWeight="700" fontFamily="ui-monospace, monospace">{formatPrice(model.currentPrice)}</text>
              </> : null}
              <line x1={WIDTH - PLOT.right + 12} y1={PLOT.top} x2={WIDTH - PLOT.right + 12} y2={HEIGHT - PLOT.bottom} stroke="#31465c" />
              {model.profile.map((level) => <g key={`profile-${level.price}-${level.side}`}>
                <rect x={level.x} y={level.y - 8} width={level.width} height="16" rx="2" fill={level.side === "bid" ? "#22d5b0" : "#ff547c"} opacity={0.1 + level.intensity * 0.25} />
                <text x={level.x + 5} y={level.y + 3} fill={level.side === "bid" ? "#4be9bd" : "#ff718f"} fontSize="8" fontFamily="ui-monospace, monospace">{formatPrice(level.price)}</text>
                <text x={WIDTH - 12} y={level.y + 3} textAnchor="end" fill="#d7e0ec" fontSize="8" fontWeight="700" fontFamily="ui-monospace, monospace">{compactMoney(level.notional)}</text>
                <title>{`${level.side.toUpperCase()} ${formatPrice(level.price)} · ${compactMoney(level.notional)}`}</title>
              </g>)}
            </g>
            <text x={WIDTH - PLOT.right + 20} y="18" fill="#718198" fontSize="10">CURRENT DEPTH · LIVE</text>
            <text x={WIDTH - PLOT.right + 20} y="39" fill="#536176" fontSize="7">PRICE</text>
            <text x={WIDTH - 12} y="39" textAnchor="end" fill="#536176" fontSize="7">NOTIONAL USD</text>
            <text x={WIDTH - PLOT.right + 20} y="55" fill="#ff718f" fontSize="7" fontWeight="700">ASKS</text>
            <text x={WIDTH - PLOT.right + 20} y="248" fill="#4be9bd" fontSize="7" fontWeight="700">BIDS</text>
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
      <div className="orderbook-chart-note"><b>Cómo leerlo</b><span>La línea celeste punteada es el precio medio actual. Cada franja horizontal es nocional de órdenes límite publicado —no volumen ya negociado—: amarillo representa mayor concentración relativa. El histórico está agrupado; “Current depth” conserva más detalle live.</span></div>
    </section>
  );
}

function buildModel(history: LiquidityFrame[], candles: HistoricalCandle[], zoom: number, rangeMinutes: number, requestedPan: { timeMs: number; price: number }) {
  if (history.length < 2) return null;
  const latestTs = history.at(-1)?.ts ?? 0;
  const oldestTs = history[0]?.ts ?? latestTs;
  const duration = rangeMinutes * 60_000 / zoom;
  const maxBack = Math.max(0, latestTs - oldestTs - duration);
  const timePan = clamp(requestedPan.timeMs, -maxBack, 0);
  const end = latestTs + timePan;
  const start = end - duration;
  const frames = history.filter((frame) => frame.ts >= start && frame.ts <= end);
  if (frames.length < 2) return null;
  const currentPrice = history.at(-1)?.mid ?? 0;
  const center = (frames.at(-1)?.mid ?? currentPrice) + requestedPan.price;
  const visibleCandles = candles.filter((candle) => candle.openTime >= start - 900_000 && candle.openTime <= end + 900_000);
  const halfRange = center * BASE_HALF_RANGE_RATIO / Math.sqrt(zoom);
  const minPrice = center - halfRange;
  const maxPrice = center + halfRange;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const frameWidth = plotWidth / Math.max(1, frames.length - 1);
  const visible = frames.flatMap((frame) =>
    frame.levels.filter((level) => level.price >= minPrice && level.price <= maxPrice),
  );
  const notionals = visible.flatMap((level) => [level.bidNotional, level.askNotional]).filter(Boolean);
  const floor = Math.max(0, percentile(notionals, 0.1));
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
          intensity: heatIntensity(notional, floor, ceiling),
        };
      }),
  );
  const candleWidth = Math.max(2.5, Math.min(9, plotWidth / Math.max(visibleCandles.length, 20) * 0.5));
  const candleShapes = visibleCandles.map((candle) => {
    const x = scale(candle.openTime, start, end, PLOT.left, WIDTH - PLOT.right);
    const openY = scale(candle.open, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom);
    const closeY = scale(candle.close, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom);
    return {
      ts: candle.openTime, x, width: candleWidth, up: candle.close >= candle.open,
      highY: scale(candle.high, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom),
      lowY: scale(candle.low, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom),
      bodyY: Math.min(openY, closeY), bodyHeight: Math.max(1.5, Math.abs(closeY - openY)),
    };
  });
  const latest = history.at(-1);
  const profileLevels = latest?.levels ?? [];
  const profileNotionals = profileLevels.flatMap((level) => [level.bidNotional, level.askNotional]).filter(Boolean);
  const profileCeiling = Math.max(1, percentile(profileNotionals, 0.95));
  const profileX = WIDTH - PLOT.right + 20;
  const profileWidth = PLOT.right - 32;
  const asks = profileLevels.filter((level) => level.askNotional > 0).sort((a, b) => a.price - b.price).slice(0, 8).reverse();
  const bids = profileLevels.filter((level) => level.bidNotional > 0).sort((a, b) => b.price - a.price).slice(0, 8);
  const profile = [
    ...asks.map((level, index) => profileRow(level.price, level.askNotional, "ask", profileX, 72 + index * 20, profileWidth, profileCeiling)),
    ...bids.map((level, index) => profileRow(level.price, level.bidNotional, "bid", profileX, 265 + index * 20, profileWidth, profileCeiling)),
  ];
  const currentPriceY = currentPrice >= minPrice && currentPrice <= maxPrice
    ? scale(currentPrice, maxPrice, minPrice, PLOT.top, HEIGHT - PLOT.bottom)
    : null;
  return { cells, candles: candleShapes, profile, minPrice, maxPrice, start, end, currentPrice, currentPriceY };
}

function profileRow(price: number, notional: number, side: "bid" | "ask", x: number, y: number, maxWidth: number, ceiling: number) {
  const intensity = Math.sqrt(Math.min(1, notional / ceiling));
  return { price, side, notional, x, y, intensity, width: maxWidth * intensity };
}

function heatIntensity(notional: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) return notional > 0 ? 1 : 0;
  const normalized = (Math.log1p(notional) - Math.log1p(floor)) / (Math.log1p(ceiling) - Math.log1p(floor));
  return clamp(normalized, 0.06, 1);
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
        {formatDuration(end - start)} window
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
      <text x={(PLOT.left + WIDTH - PLOT.right) / 2} y={HEIGHT - 2} textAnchor="middle" fill="#536176">MARKET TIMELINE</text>
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

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h` : `${minutes}m`;
}

function time(value: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}
