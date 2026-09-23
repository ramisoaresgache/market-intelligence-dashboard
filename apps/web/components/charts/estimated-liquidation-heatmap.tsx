"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useState } from "react";
import { decayedExposure, type DerivativesSample, type EstimatedLiquidationZone } from "../../lib/market/engine/estimated-liquidations";
import { percentile } from "../../lib/market/engine/visualization";
import type { LiquidationEvent } from "../../lib/market/types";
import type { HistoricalCandle } from "../../lib/market/use-historical-liquidation-map";
import { useEChart } from "./use-echart";

type Props = { symbol: string; samples: DerivativesSample[]; candles: HistoricalCandle[]; zones: EstimatedLiquidationZone[]; observed: LiquidationEvent[]; historyState: "loading" | "live" | "unavailable" };
type MapSnapshot = Props & { capturedAt: number };

export function EstimatedLiquidationHeatmap({ symbol, samples, candles, zones, observed, historyState }: Props) {
  const [threshold, setThreshold] = useState(0.2);
  const [rangeHours, setRangeHours] = useState<4 | 12 | 24>(24);
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);
  const currentSnapshot = snapshot?.symbol === symbol ? snapshot : null;
  useEffect(() => {
    const ready = candles.length >= 2 || (historyState === "unavailable" && samples.length >= 2);
    if (currentSnapshot || !ready) return;
    const timer = window.setTimeout(() => setSnapshot((current) => current?.symbol === symbol ? current : captureMap({ symbol, samples, candles, zones, observed, historyState })), 0);
    return () => window.clearTimeout(timer);
  }, [candles, currentSnapshot, historyState, observed, samples, symbol, zones]);
  const frozen = currentSnapshot ?? { symbol, samples, candles, zones, observed, historyState, capturedAt: 0 };
  const model = useMemo(() => buildModel(frozen.samples, frozen.candles, frozen.zones, frozen.observed, threshold, rangeHours), [frozen.samples, frozen.candles, frozen.zones, frozen.observed, threshold, rangeHours]);
  const option = useMemo(() => buildOption(model), [model]);
  const { containerRef, reset, exportPng } = useEChart(option);
  const refresh = () => {
    setSnapshot(captureMap({ symbol, samples, candles, zones, observed, historyState }));
    reset();
  };
  return <section className="chart-card liquidation-map-card" id="estimated-liquidations">
    <div className="panel-heading liquidation-map-heading"><div><span className="section-kicker">MAPA DE LIQUIDACIONES ESTIMADAS · ECHARTS</span><h2>Zonas donde podría concentrarse el riesgo de liquidación</h2><p>Bandas modeladas sobre velas históricas reales, con zoom, paneo, crosshair y navegador nativos.</p></div>
      <div className="map-heading-controls"><span className="market-chip">{symbol.replace("USDT", "/USDT")} PERPETUAL</span><div className="time-range-control">{([4, 12, 24] as const).map((hours) => <button key={hours} type="button" className={rangeHours === hours ? "active" : ""} onClick={() => { setRangeHours(hours); reset(); }}>{hours} h</button>)}</div><div className="chart-toolbar"><button type="button" className="refresh-control" onClick={refresh} title="Capturar los datos más recientes">↻ Actualizar</button><button type="button" className="text-control" onClick={reset}>Reset</button><button type="button" className="export-control" onClick={() => exportPng(`${symbol}-estimated-liquidations.png`)}>Export PNG</button></div></div>
    </div>
    <div className="chart-legend liquidation-map-legend"><span className="model-badge">ESTIMADO</span><span>{rangeHours} H HISTÓRICAS</span><span><i className="liquidation-scale" /> exposición estimada</span><span><i className="candle-key up" /> velas reales Binance</span><span className={`history-state ${frozen.historyState}`}>{frozen.historyState === "live" ? "HISTORIAL LIVE" : frozen.historyState === "loading" ? "CARGANDO HISTORIAL" : "HISTORIAL NO DISPONIBLE"}</span>{currentSnapshot ? <span className="snapshot-time">CAPTURA {formatTime(currentSnapshot.capturedAt)}</span> : null}<label className="threshold-control">UMBRAL<input aria-label="Liquidation heatmap threshold" type="range" min="0" max="0.8" step="0.05" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /><b>{Math.round(threshold * 100)}%</b></label></div>
    <div ref={containerRef} className="echart-surface liquidation-echart" role="img" aria-label={`${symbol} interactive estimated liquidation heatmap`} />
    <div className="model-disclaimer"><b>NIVELES ESTIMADOS</b><span>Las velas son datos históricos reales de Binance USD-M. Las bandas son un modelo propio basado en cambios de interés abierto, precio y escenarios de apalancamiento; no representan posiciones individuales publicadas por los exchanges.</span></div>
  </section>;
}

function captureMap(props: Props): MapSnapshot { return { ...props, samples: [...props.samples], candles: [...props.candles], zones: [...props.zones], observed: [...props.observed], capturedAt: Date.now() }; }

type Model = ReturnType<typeof buildModel>;
function buildModel(samples: DerivativesSample[], historical: HistoricalCandle[], zones: EstimatedLiquidationZone[], observed: LiquidationEvent[], threshold: number, rangeHours: 4 | 12 | 24) {
  const source = historical.length >= 2 ? historical : sessionCandles(samples); if (source.length < 2) return null;
  const end = source.at(-1)?.closeTime ?? Date.now(); const start = end - rangeHours * 3_600_000; const candles = source.filter((candle) => candle.closeTime >= start); if (candles.length < 2) return null;
  const lastPrice = samples.at(-1)?.price ?? candles.at(-1)?.close ?? 0; const minPrice = Math.min(lastPrice * 0.945, ...candles.map((candle) => candle.low)); const maxPrice = Math.max(lastPrice * 1.055, ...candles.map((candle) => candle.high));
  const candidates = zones.filter((zone) => zone.createdAt >= start && zone.createdAt <= end && zone.liquidationPrice >= minPrice && zone.liquidationPrice <= maxPrice); const halfLife = rangeHours * 3_600_000; const exposures = candidates.map((zone) => decayedExposure(zone, end, halfLife)); const ceiling = Math.max(1, percentile(exposures, 0.92));
  const bands = candidates.flatMap((zone) => { const exposure = decayedExposure(zone, end, halfLife); const intensity = Math.min(1, (exposure / ceiling) ** 0.55); return intensity >= threshold ? [[zone.createdAt, zone.liquidationPrice, end, intensity, exposure, zone.leverage, zone.side === "long" ? 0 : 1]] : []; });
  const candleData = candles.map((candle) => [candle.openTime, candle.open, candle.close, candle.low, candle.high]);
  const events = observed.filter((event) => event.ts >= start && event.ts <= end).map((event) => ({ value: [event.ts, event.price, event.notional], itemStyle: { color: event.side === "long" ? "#ff345f" : "#13e9ad" }, name: `${event.side} · ${event.exchange}` }));
  return { start, end, minPrice, maxPrice, lastPrice, maxExposure: Math.max(0, ...exposures), bands, candleData, events };
}

const bandRender: echarts.CustomSeriesRenderItem = (params, api) => {
  if (!api.size) return undefined; const start = api.coord([api.value(0) as number, api.value(1) as number]) as number[]; const end = api.coord([api.value(2) as number, api.value(1) as number]) as number[]; const height = Math.max(4, Math.abs((api.size([0, (api.value(1) as number) * 0.0007]) as number[])[1])); const bounds = params.coordSys as unknown as { x: number; y: number; width: number; height: number };
  const rect = echarts.graphic.clipRectByRect({ x: start[0], y: start[1] - height / 2, width: Math.max(2, end[0] - start[0]), height }, bounds); return rect ? { type: "rect", shape: rect, style: { fill: api.visual("color") as string, opacity: 0.35 + (api.value(3) as number) * 0.65 } } : undefined;
};
const candleRender: echarts.CustomSeriesRenderItem = (_params, api) => { if (!api.size) return undefined; const time = api.value(0) as number; const open = api.value(1) as number; const close = api.value(2) as number; const low = api.value(3) as number; const high = api.value(4) as number; const hp = api.coord([time, high]) as number[]; const lp = api.coord([time, low]) as number[]; const op = api.coord([time, open]) as number[]; const cp = api.coord([time, close]) as number[]; const color = close >= open ? "#20e6a3" : "#ff4778"; const width = Math.max(3, Math.min(9, (api.size([15 * 60_000, 0]) as number[])[0] * 0.58)); return { type: "group", children: [{ type: "line", shape: { x1: hp[0], y1: hp[1], x2: lp[0], y2: lp[1] }, style: { stroke: color, lineWidth: 1.2 } }, { type: "rect", shape: { x: op[0] - width / 2, y: Math.min(op[1], cp[1]), width, height: Math.max(2, Math.abs(op[1] - cp[1])) }, style: { fill: color } }] }; };

function buildOption(model: Model): echarts.EChartsOption {
  if (!model) return { backgroundColor: "#05070d" };
  return { animation: false, backgroundColor: "#05070d", grid: { left: 72, right: 72, top: 28, bottom: 66 }, tooltip: { trigger: "item", confine: true, backgroundColor: "#08070d", borderColor: "#4b225c", textStyle: { color: "#e0d5e8", fontSize: 11 } }, axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis: { type: "time", min: model.start, max: model.end, axisLabel: { color: "#9a88a5" }, axisLine: { lineStyle: { color: "#4b225c" } }, splitLine: { show: true, lineStyle: { color: "#351044", type: "dashed" } } }, yAxis: { type: "value", min: model.minPrice, max: model.maxPrice, scale: true, position: "right", axisLabel: { color: "#aa96b4" }, axisLine: { show: true, lineStyle: { color: "#4b225c" } }, splitLine: { lineStyle: { color: "#50145e" } } },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: true }, { type: "inside", yAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "shift", moveOnMouseMove: "shift" }, { type: "slider", xAxisIndex: 0, height: 20, bottom: 12, borderColor: "#3a2950", backgroundColor: "#11142a", fillerColor: "rgba(102,134,189,.28)", handleStyle: { color: "#725f91" }, textStyle: { color: "#9385a3" } }], visualMap: { show: true, orient: "vertical", left: 8, top: 70, min: 0, max: 1, dimension: 3, seriesIndex: 0, calculable: false, itemWidth: 12, itemHeight: 190, text: [compactMoney(model.maxExposure), "0"], textStyle: { color: "#8c7898", fontSize: 8 }, inRange: { color: ["#43105d", "#266b91", "#28bb84", "#f5ec18"] } },
    series: [{ name: "Estimated exposure", type: "custom", coordinateSystem: "cartesian2d", renderItem: bandRender, dimensions: ["from", "price", "to", "intensity", "exposure", "leverage", "side"], encode: { x: [0, 2], y: 1 }, tooltip: { formatter: liquidationTooltip }, data: model.bands, z: 1 }, { name: "Price candles", type: "custom", coordinateSystem: "cartesian2d", renderItem: candleRender, dimensions: ["time", "open", "close", "low", "high"], encode: { x: 0, y: [1, 2, 3, 4], tooltip: [1, 2, 3, 4] }, data: model.candleData, z: 5 }, { name: "Observed liquidations", type: "scatter", data: model.events, symbolSize: (value: unknown) => { const values = value as number[]; return Math.min(14, 4 + Math.log10(Math.max(1, values[2]))); }, z: 7 }, { name: "Current price", type: "line", symbol: "none", data: [[model.start, model.lastPrice], [model.end, model.lastPrice]], lineStyle: { color: "#ff4f89", type: "dashed", width: 1.2 }, tooltip: { show: false }, markPoint: { symbol: "rect", symbolSize: [70, 20], label: { formatter: formatPrice(model.lastPrice), color: "#16040a", fontWeight: "bold" }, itemStyle: { color: "#ff4f89" }, data: [{ name: "Current price", coord: [model.end, model.lastPrice] }] }, z: 8 }] };
}

function sessionCandles(samples: DerivativesSample[]): HistoricalCandle[] { return samples.slice(1).map((sample, index) => { const previous = samples[index]; return { openTime: previous.ts, closeTime: sample.ts, open: previous.price, high: Math.max(previous.price, sample.price), low: Math.min(previous.price, sample.price), close: sample.price }; }); }
function formatPrice(value: number): string { return value >= 1000 ? value.toFixed(1) : value.toFixed(3); }
function formatTime(value: number): string { return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value); }
function compactMoney(value: number): string { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value); }
function liquidationTooltip(params: unknown): string {
  const values = (params as { value?: unknown }).value;
  if (!Array.isArray(values)) return "Exposición estimada";
  return `<b>Exposición estimada</b><br/>Precio: ${formatPrice(Number(values[1]))}<br/>Monto modelado: ${compactMoney(Number(values[4]))}<br/>Apalancamiento: ${Number(values[5])}x<br/>Lado: ${Number(values[6]) === 0 ? "LONG" : "SHORT"}`;
}
