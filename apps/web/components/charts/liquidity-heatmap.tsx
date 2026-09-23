"use client";

import * as echarts from "echarts";
import { useMemo, useState } from "react";
import type { LiquidityFrame } from "../../lib/market/use-liquidity-history";
import type { HistoricalCandle } from "../../lib/market/use-historical-liquidation-map";
import { percentile } from "../../lib/market/engine/visualization";
import { useEChart } from "./use-echart";

const RANGE_OPTIONS = [15, 60, 240] as const;
type RangeMinutes = (typeof RANGE_OPTIONS)[number];
type Props = { symbol: string; history: LiquidityFrame[]; candles: HistoricalCandle[] };

export function LiquidityHeatmap({ symbol, history, candles }: Props) {
  const [rangeMinutes, setRangeMinutes] = useState<RangeMinutes>(240);
  const model = useMemo(() => buildModel(history, candles, rangeMinutes), [history, candles, rangeMinutes]);
  const option = useMemo(() => buildOption(model), [model]);
  const { containerRef, reset, exportPng } = useEChart(option);
  return <section className="chart-card heatmap-card" id="liquidity">
    <div className="panel-heading"><div><span className="section-kicker">REAL EXCHANGE ORDER BOOKS · ECHARTS</span><h2>Order book liquidity heatmap</h2><p>Cloudflare history plus 160 live price levels nearest the market from Binance + Bybit.</p></div>
      <div className="orderbook-heading-controls"><div className="time-range-control" aria-label="Order book time range">{RANGE_OPTIONS.map((minutes) => <button key={minutes} type="button" className={rangeMinutes === minutes ? "active" : ""} onClick={() => { setRangeMinutes(minutes); reset(); }}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}</div>
        <div className="chart-toolbar" aria-label="Chart controls"><button type="button" className="text-control" onClick={reset}>Reset</button><button type="button" className="export-control" onClick={() => exportPng(`${symbol}-orderbook.png`)}>Export PNG</button></div></div>
    </div>
    <div className="chart-legend"><span><i className="legend-gradient" /> order size: blue lower · cyan medium · yellow larger</span><span><i className="candle-key up" /> price candles</span><span><i className="legend-line current-price-key" /> current midpoint</span><small>Wheel/pinch to zoom · drag to pan · use the lower navigator</small></div>
    <div className="echarts-orderbook-layout"><div ref={containerRef} className="echart-surface orderbook-echart" role="img" aria-label={`${symbol} interactive order book heatmap`} /><DepthLadder frame={history.at(-1)} /></div>
    <div className="orderbook-chart-note"><b>Cómo leerlo</b><span>La línea celeste punteada es el precio medio actual. Cada franja horizontal es nocional de órdenes límite publicado —no volumen ejecutado—. ECharts administra zoom, paneo, ejes, tooltip y navegación temporal.</span></div>
  </section>;
}

type Model = ReturnType<typeof buildModel>;
function buildModel(history: LiquidityFrame[], candles: HistoricalCandle[], rangeMinutes: RangeMinutes) {
  const latest = history.at(-1); if (!latest) return null;
  const end = latest.ts; const start = end - rangeMinutes * 60_000;
  const frames = history.filter((frame) => frame.ts >= start);
  const visibleCandles = candles.filter((candle) => candle.closeTime >= start && candle.openTime <= end);
  const notionals = frames.flatMap((frame) => frame.levels.flatMap((level) => [level.bidNotional, level.askNotional])).filter((value) => value > 0);
  const floor = percentile(notionals, 0.1); const ceiling = Math.max(1, percentile(notionals, 0.95));
  // Historical snapshots can contain only a few significant levels. Their median gap is
  // not the book tick size and would otherwise render as an enormous vertical block.
  const liveBucket = inferBucket(latest.levels);
  const bucketCap = Math.max(liveBucket * 4, latest.mid * 0.00005);
  const heat = frames.flatMap((frame) => {
    const bucket = Math.min(inferBucket(frame.levels), bucketCap);
    return frame.levels.flatMap((level) => { const notional = level.bidNotional + level.askNotional; return notional ? [[frame.ts, level.price, heatIntensity(notional, floor, ceiling), notional, bucket]] : []; });
  });
  const candleData = visibleCandles.map((candle) => [candle.openTime, candle.open, candle.close, candle.low, candle.high]);
  const prices = [...frames.flatMap((frame) => frame.levels.map((level) => level.price)), ...visibleCandles.flatMap((candle) => [candle.low, candle.high]), latest.mid];
  const rawMin = Math.min(...prices); const rawMax = Math.max(...prices); const padding = Math.max(latest.mid * 0.00025, (rawMax - rawMin) * 0.06);
  return { start, end, currentPrice: latest.mid, minPrice: rawMin - padding, maxPrice: rawMax + padding, heat, candleData };
}

const heatRender: echarts.CustomSeriesRenderItem = (params, api) => {
  if (!api.size) return undefined;
  const point = api.coord([api.value(0) as number, api.value(1) as number]) as number[]; const size = api.size([60_000, api.value(4) as number]) as number[];
  const bounds = params.coordSys as unknown as { x: number; y: number; width: number; height: number };
  const rect = echarts.graphic.clipRectByRect({ x: point[0] - Math.max(2, size[0]) / 2, y: point[1] - Math.max(2, Math.abs(size[1])) / 2, width: Math.max(2, size[0] + 1), height: Math.max(2, Math.abs(size[1])) }, bounds);
  return rect ? { type: "rect", shape: rect, style: { fill: api.visual("color") as string, opacity: 0.9 } } : undefined;
};
const candleRender: echarts.CustomSeriesRenderItem = (_params, api) => {
  if (!api.size) return undefined;
  const time = api.value(0) as number; const open = api.value(1) as number; const close = api.value(2) as number; const low = api.value(3) as number; const high = api.value(4) as number;
  const highPoint = api.coord([time, high]) as number[]; const lowPoint = api.coord([time, low]) as number[]; const openPoint = api.coord([time, open]) as number[]; const closePoint = api.coord([time, close]) as number[]; const color = close >= open ? "#2ee6aa" : "#ff5377"; const candleSize = api.size([15 * 60_000, 0]) as number[]; const width = Math.max(3, Math.min(9, candleSize[0] * 0.55));
  return { type: "group", children: [{ type: "line", shape: { x1: highPoint[0], y1: highPoint[1], x2: lowPoint[0], y2: lowPoint[1] }, style: { stroke: color, lineWidth: 1.2 } }, { type: "rect", shape: { x: openPoint[0] - width / 2, y: Math.min(openPoint[1], closePoint[1]), width, height: Math.max(2, Math.abs(openPoint[1] - closePoint[1])) }, style: { fill: color } }] };
};

function buildOption(model: Model): echarts.EChartsOption {
  if (!model) return { backgroundColor: "#070b12" };
  return { animation: false, backgroundColor: "#070b12", grid: { left: 70, right: 24, top: 25, bottom: 62 }, tooltip: { trigger: "item", confine: true, backgroundColor: "#080d14", borderColor: "#26364b", textStyle: { color: "#d7e0ec", fontSize: 11 } },
    xAxis: { type: "time", min: model.start, max: model.end, axisLine: { lineStyle: { color: "#26364b" } }, axisLabel: { color: "#718198" }, splitLine: { show: true, lineStyle: { color: "#13202f", type: "dashed" } } },
    yAxis: { type: "value", min: model.minPrice, max: model.maxPrice, scale: true, axisLabel: { color: "#718198" }, axisLine: { show: true, lineStyle: { color: "#26364b" } }, splitLine: { lineStyle: { color: "#172333" } } },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false }, { type: "inside", yAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "shift", moveOnMouseMove: "shift" }, { type: "slider", xAxisIndex: 0, height: 18, bottom: 10, borderColor: "#26364b", backgroundColor: "#0a1320", fillerColor: "rgba(31,214,228,.14)", handleStyle: { color: "#1fd6e4" }, textStyle: { color: "#718198" }, dataBackground: { lineStyle: { color: "#2b7891" }, areaStyle: { color: "#17354b" } } }],
    visualMap: { show: false, min: 0, max: 1, dimension: 2, seriesIndex: 0, inRange: { color: ["#082a49", "#087da3", "#16cad5", "#ffe05a"] } },
    series: [{ name: "Visible order notional", type: "custom", coordinateSystem: "cartesian2d", renderItem: heatRender, dimensions: ["time", "price", "intensity", "notional", "bucket"], encode: { x: 0, y: 1, tooltip: [1, 3] }, data: model.heat, z: 1 }, { name: "Price candles", type: "custom", coordinateSystem: "cartesian2d", renderItem: candleRender, dimensions: ["time", "open", "close", "low", "high"], encode: { x: 0, y: [1, 2, 3, 4], tooltip: [1, 2, 3, 4] }, data: model.candleData, z: 5 }, { name: "Current midpoint", type: "line", symbol: "none", data: [[model.start, model.currentPrice], [model.end, model.currentPrice]], lineStyle: { color: "#67deea", type: "dashed", width: 1.3 }, tooltip: { show: false }, markPoint: { symbol: "rect", symbolSize: [68, 20], label: { color: "#d8fbff", formatter: formatPrice(model.currentPrice), fontSize: 9 }, itemStyle: { color: "#123a47", borderColor: "#67deea" }, data: [{ name: "Current price", coord: [model.end, model.currentPrice] }] }, z: 6 }] };
}

function DepthLadder({ frame }: { frame?: LiquidityFrame }) {
  const levels = frame?.levels ?? []; const asks = levels.filter((level) => level.askNotional > 0).sort((a, b) => a.price - b.price).slice(0, 8).reverse(); const bids = levels.filter((level) => level.bidNotional > 0).sort((a, b) => b.price - a.price).slice(0, 8); const ceiling = Math.max(1, percentile([...asks.map((level) => level.askNotional), ...bids.map((level) => level.bidNotional)], 0.95));
  return <aside className="depth-ladder"><header><b>CURRENT DEPTH · LIVE</b><span>PRICE</span><span>NOTIONAL USD</span></header><DepthSide label="ASKS" levels={asks.map((level) => ({ price: level.price, notional: level.askNotional }))} ceiling={ceiling} side="ask" /><div className="depth-mid">MID {frame ? formatPrice(frame.mid) : "—"}</div><DepthSide label="BIDS" levels={bids.map((level) => ({ price: level.price, notional: level.bidNotional }))} ceiling={ceiling} side="bid" /></aside>;
}
function DepthSide({ label, levels, ceiling, side }: { label: string; levels: Array<{ price: number; notional: number }>; ceiling: number; side: "bid" | "ask" }) { return <section className={`depth-side ${side}`}><strong>{label}</strong>{levels.map((level) => <div key={`${side}-${level.price}`}><i style={{ width: `${Math.max(3, Math.sqrt(level.notional / ceiling) * 100)}%` }} /><span>{formatPrice(level.price)}</span><b>{compactMoney(level.notional)}</b></div>)}</section>; }
function inferBucket(levels: LiquidityFrame["levels"]): number { const prices = [...new Set(levels.map((level) => level.price))].sort((a, b) => a - b); const differences = prices.slice(1).map((price, index) => price - prices[index]).filter((value) => value > 0); return percentile(differences, 0.5) || 1; }
function heatIntensity(notional: number, floor: number, ceiling: number): number { if (ceiling <= floor) return notional > 0 ? 1 : 0; return Math.min(1, Math.max(0.04, (Math.log1p(notional) - Math.log1p(floor)) / (Math.log1p(ceiling) - Math.log1p(floor)))); }
function formatPrice(value: number): string { return value >= 1000 ? value.toFixed(1) : value.toFixed(3); }
function compactMoney(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value); }
