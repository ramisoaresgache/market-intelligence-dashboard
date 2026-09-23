"use client";

import { useMemo, useRef, useState, type WheelEvent } from "react";
import { consolidateOrderBooks, percentile } from "../../lib/market/engine/visualization";
import type { MarketSnapshot } from "../../lib/market/types";
import { exportSvgAsPng } from "./chart-export";
import { ChartToolbar } from "./chart-toolbar";

const WIDTH = 720;
const HEIGHT = 430;
const PLOT = { left: 78, right: 28, top: 25, bottom: 48 };

export function OrderBookLiquidity({ symbol, snapshot }: { symbol: string; snapshot?: MarketSnapshot }) {
  const [zoom, setZoom] = useState(1);
  const [exportLabel, setExportLabel] = useState("Export PNG");
  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(() => buildModel(snapshot, zoom), [snapshot, zoom]);
  const changeZoom = (direction: number) => setZoom((current) => clamp(current + direction * 0.5, 1, 4));
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1 : -1);
  };
  const exportChart = async () => {
    if (!svgRef.current) return;
    setExportLabel("Saving…");
    try {
      await exportSvgAsPng(svgRef.current, `${symbol}-orderbook.png`);
      setExportLabel("PNG ready");
    } catch {
      setExportLabel("Export failed");
    }
  };

  return (
    <section className="chart-card orderbook-card">
      <div className="panel-heading compact-heading">
        <div>
          <span className="section-kicker">LIVE DEPTH</span>
          <h2>Order book liquidity</h2>
          <p>Real orders grouped by price across Binance and Bybit.</p>
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
        <span><i className="legend-bar bid-bar" /> bids</span>
        <span><i className="legend-bar ask-bar" /> asks</span>
        <span><i className="legend-bar wall-bar" /> large wall</span>
      </div>
      <div className="chart-stage">
        {model ? (
          <svg
            ref={svgRef}
            className="market-chart"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${symbol} live order book liquidity`}
            onWheel={handleWheel}
          >
            <defs>
              <linearGradient id="bidDepth" x1="1" x2="0"><stop stopColor="#20e2c8" stopOpacity=".9" /><stop offset="1" stopColor="#0d7280" stopOpacity=".3" /></linearGradient>
              <linearGradient id="askDepth"><stop stopColor="#7d2949" stopOpacity=".28" /><stop offset="1" stopColor="#ff557d" stopOpacity=".9" /></linearGradient>
            </defs>
            <rect width={WIDTH} height={HEIGHT} fill="#070b12" />
            {model.ticks.map((tick) => (
              <g key={tick.price}>
                <line x1={PLOT.left} y1={tick.y} x2={WIDTH - PLOT.right} y2={tick.y} stroke="#172333" />
                <text x={PLOT.left - 10} y={tick.y + 3} textAnchor="end" fill="#7b8a9f" fontSize="10" fontFamily="ui-monospace, monospace">{formatPrice(tick.price)}</text>
              </g>
            ))}
            <line x1={model.centerX} y1={PLOT.top} x2={model.centerX} y2={HEIGHT - PLOT.bottom} stroke="#27364a" />
            {model.rows.map((row) => {
              const bidWidth = row.bidRatio * model.halfWidth;
              const askWidth = row.askRatio * model.halfWidth;
              return (
                <g key={row.price}>
                  {bidWidth > 0 && <rect x={model.centerX - bidWidth} y={row.y - row.height / 2} width={bidWidth} height={row.height} rx="2" fill={row.wall ? "#f1d75b" : "url(#bidDepth)"}><title>{`Bid ${formatPrice(row.price)} · ${compactMoney(row.bidNotional)} · ${row.exchanges.join(" + ")}`}</title></rect>}
                  {askWidth > 0 && <rect x={model.centerX} y={row.y - row.height / 2} width={askWidth} height={row.height} rx="2" fill={row.wall ? "#ffb24e" : "url(#askDepth)"}><title>{`Ask ${formatPrice(row.price)} · ${compactMoney(row.askNotional)} · ${row.exchanges.join(" + ")}`}</title></rect>}
                </g>
              );
            })}
            <line x1={PLOT.left} y1={model.midY} x2={WIDTH - PLOT.right} y2={model.midY} stroke="#e7eef8" strokeDasharray="5 5" opacity=".7" />
            <rect x={WIDTH - PLOT.right - 78} y={model.midY - 12} width="78" height="23" rx="4" fill="#e7eef8" />
            <text x={WIDTH - PLOT.right - 7} y={model.midY + 4} textAnchor="end" fill="#071018" fontSize="10" fontWeight="700">{formatPrice(model.mid)}</text>
            <text x={model.centerX - 15} y={HEIGHT - 18} textAnchor="end" fill="#2ee6b1" fontSize="10">BID NOTIONAL</text>
            <text x={model.centerX + 15} y={HEIGHT - 18} fill="#ff6486" fontSize="10">ASK NOTIONAL</text>
            <text x={17} y={HEIGHT / 2} transform={`rotate(-90 17 ${HEIGHT / 2})`} textAnchor="middle" fill="#536176" fontSize="10">PRICE (USDT)</text>
          </svg>
        ) : (
          <div className="chart-empty"><span className="pulse-ring" /><strong>Waiting for order books</strong><p>Binance and Bybit will appear independently.</p></div>
        )}
      </div>
    </section>
  );
}

function buildModel(snapshot: MarketSnapshot | undefined, zoom: number) {
  if (!snapshot?.orderBooks.length) return null;
  const consolidated = consolidateOrderBooks(snapshot.orderBooks);
  if (consolidated.mid === null) return null;
  const rawMin = Math.min(...consolidated.levels.map((level) => level.price));
  const rawMax = Math.max(...consolidated.levels.map((level) => level.price));
  const halfRange = Math.max(
    consolidated.mid * 0.00005,
    (rawMax - rawMin) / (2 * zoom),
  );
  const min = consolidated.mid - halfRange;
  const max = consolidated.mid + halfRange;
  const levels = consolidated.levels.filter((level) => level.price >= min && level.price <= max);
  if (!levels.length) return null;
  const notionals = levels.flatMap((level) => [level.bidNotional, level.askNotional]).filter(Boolean);
  const maxNotional = Math.max(...notionals, 1);
  const wallThreshold = percentile(notionals, 0.88);
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const centerX = PLOT.left + (WIDTH - PLOT.left - PLOT.right) / 2;
  const halfWidth = (WIDTH - PLOT.left - PLOT.right) / 2 - 8;
  const rowHeight = Math.max(3, Math.min(11, plotHeight / Math.max(25, levels.length)));
  const rows = levels.map((level) => ({
    ...level,
    y: scale(level.price, max, min, PLOT.top, HEIGHT - PLOT.bottom),
    height: rowHeight,
    bidRatio: Math.log1p(level.bidNotional) / Math.log1p(maxNotional),
    askRatio: Math.log1p(level.askNotional) / Math.log1p(maxNotional),
    wall: Math.max(level.bidNotional, level.askNotional) >= wallThreshold,
  }));
  const ticks = Array.from({ length: 7 }, (_, index) => {
    const ratio = index / 6;
    return { price: max - (max - min) * ratio, y: PLOT.top + plotHeight * ratio };
  });
  return {
    rows,
    ticks,
    mid: consolidated.mid,
    midY: scale(consolidated.mid, max, min, PLOT.top, HEIGHT - PLOT.bottom),
    centerX,
    halfWidth,
  };
}

function scale(value: number, min: number, max: number, start: number, end: number): number {
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
