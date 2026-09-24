"use client";

import * as echarts from "echarts";
import { useMemo, useState } from "react";
import { buildLiquidationProfile } from "../../lib/market/engine/liquidation-profile";
import { decayedExposure, isLiquidationZoneConsumed, type EstimatedLiquidationZone } from "../../lib/market/engine/estimated-liquidations";
import type { HistoricalCandle } from "../../lib/market/use-historical-liquidation-map";
import { InfoTooltip } from "../info-tooltip";
import { useEChart } from "./use-echart";

type RangeHours = 4 | 12 | 24;
type Props = { symbol: string; currentPrice?: number | null; zones: EstimatedLiquidationZone[]; candles: HistoricalCandle[] };

export function LiquidationProfileMap({ symbol, currentPrice, zones, candles }: Props) {
  const [rangeHours, setRangeHours] = useState<RangeHours>(24);
  const model = useMemo(() => buildModel(currentPrice, zones, candles, rangeHours), [candles, currentPrice, rangeHours, zones]);
  const option = useMemo(() => buildOption(model), [model]);
  const { containerRef, reset, exportPng } = useEChart(option);
  return <section className="chart-card liquidation-profile-card" id="liquidation-profile">
    <div className="panel-heading"><div><span className="section-kicker">PERFIL DE RIESGO · MODELO PROPIO</span><h2 className="heading-with-help">Mapa de intensidad de liquidaciones estimadas <InfoTooltip label="Mapa de intensidad de liquidaciones" text="Agrupa por precio niveles de liquidación modelados. Las barras comparan intensidad relativa; las curvas acumulan riesgo largo y corto. No representa contratos pendientes exactos ni datos de CoinGlass." /></h2><p>Distribución relativa por precio basada en interés abierto, precio y escenarios de apalancamiento.</p></div>
      <div className="orderbook-heading-controls"><span className="market-chip">{symbol.replace("USDT", "/USDT")}</span><div className="time-range-control">{([4, 12, 24] as const).map((hours) => <button key={hours} type="button" className={rangeHours === hours ? "active" : ""} onClick={() => { setRangeHours(hours); reset(); }}>{hours} h</button>)}</div><div className="chart-toolbar"><button type="button" className="text-control" onClick={reset}>Reset</button><button type="button" className="export-control" onClick={() => exportPng(`${symbol}-liquidation-profile.png`)}>Export PNG</button></div></div>
    </div>
    <div className="chart-legend liquidation-profile-legend"><span><i className="profile-dot long" /> liquidaciones largas estimadas</span><span><i className="profile-dot short" /> liquidaciones cortas estimadas</span><span><i className="profile-line long" /> riesgo largo acumulado</span><span><i className="profile-line short" /> riesgo corto acumulado</span><small>Eje X: precio · Eje Y: intensidad relativa</small></div>
    <div ref={containerRef} className="echart-surface liquidation-profile-echart" role="img" aria-label={`${symbol} estimated liquidation intensity by price`} />
    <div className="model-disclaimer"><b>NO ES COINGLASS</b><span>Se usan únicamente datos públicos y el modelo propio del dashboard. Los exchanges no publican la distribución exacta de posiciones por precio; por eso no se inventa un desglose por exchange.</span></div>
  </section>;
}

type Model = ReturnType<typeof buildModel>;
function buildModel(currentPrice: number | null | undefined, zones: EstimatedLiquidationZone[], candles: HistoricalCandle[], rangeHours: RangeHours) {
  const price = currentPrice ?? candles.at(-1)?.close;
  if (!price || price <= 0) return null;
  const end = candles.at(-1)?.closeTime ?? Date.now();
  const start = end - rangeHours * 3_600_000;
  const relevantCandles = candles.filter((candle) => candle.closeTime >= start);
  const halfLife = rangeHours * 3_600_000;
  const active = zones.filter((zone) => zone.createdAt >= start && zone.createdAt <= end && Math.abs(zone.liquidationPrice / price - 1) <= 0.14 && !isLiquidationZoneConsumed(zone, relevantCandles)).map((zone) => ({ ...zone, exposure: decayedExposure(zone, end, halfLife) }));
  const profile = buildLiquidationProfile(active, price);
  return { currentPrice: price, profile };
}

function buildOption(model: Model): echarts.EChartsOption {
  if (!model || !model.profile.length) return { backgroundColor: "#070b12", title: { text: "Esperando niveles estimados activos", left: "center", top: "middle", textStyle: { color: "#8190a5", fontSize: 12 } } };
  const data = model.profile.map((row) => [row.price, row.longExposure, row.shortExposure, row.relativeIntensity, row.accumulatedLong, row.accumulatedShort]);
  return { animation: false, backgroundColor: "#070b12", title: { show: false }, grid: { left: 62, right: 62, top: 28, bottom: 64 }, tooltip: { trigger: "axis", confine: true, backgroundColor: "#080d14", borderColor: "#26364b", textStyle: { color: "#dce6f2", fontSize: 11 }, formatter: profileTooltip },
    xAxis: { type: "value", scale: true, axisLabel: { color: "#8c9bb0", formatter: (value: number) => compactPrice(value) }, axisLine: { lineStyle: { color: "#2b394d" } }, splitLine: { show: false }, axisPointer: { type: "line", label: { show: true, formatter: (params) => compactPrice(Number(params.value)) } } },
    yAxis: [{ type: "value", min: 0, max: 100, name: "INTENSIDAD RELATIVA", nameTextStyle: { color: "#8291a6", fontSize: 9 }, axisLabel: { color: "#8291a6", formatter: "{value}%" }, splitLine: { lineStyle: { color: "#1b2736", type: "dashed" } } }],
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }, { type: "slider", xAxisIndex: 0, height: 18, bottom: 10, borderColor: "#26364b", backgroundColor: "#0a1320", fillerColor: "rgba(31,214,228,.14)", handleStyle: { color: "#1fd6e4" }, showDetail: false }],
    series: [
      { name: "Largos", type: "bar", data: data.map((row) => [row[0], row[1] ? row[3] : 0, row[1]]), barWidth: "72%", itemStyle: { color: "#ff476f", opacity: .82 }, encode: { x: 0, y: 1 } },
      { name: "Cortos", type: "bar", data: data.map((row) => [row[0], row[2] ? row[3] : 0, row[2]]), barWidth: "72%", itemStyle: { color: "#26d6bd", opacity: .82 }, encode: { x: 0, y: 1 } },
      { name: "Largo acumulado", type: "line", data: data.map((row) => [row[0], row[4]]), showSymbol: false, smooth: .22, lineStyle: { color: "#ff476f", width: 2 }, areaStyle: { color: "rgba(255,71,111,.1)" } },
      { name: "Corto acumulado", type: "line", data: data.map((row) => [row[0], row[5]]), showSymbol: false, smooth: .22, lineStyle: { color: "#26d6bd", width: 2 }, areaStyle: { color: "rgba(38,214,189,.1)" } },
      { name: "Precio actual", type: "line", data: [[model.currentPrice, 0], [model.currentPrice, 100]], symbol: "none", lineStyle: { color: "#f2ce58", type: "dashed", width: 1.4 }, tooltip: { show: false }, z: 8 },
    ] };
}

function profileTooltip(params: unknown): string {
  const items = Array.isArray(params) ? params as Array<{ seriesName?: string; value?: unknown }> : [];
  const first = items[0]?.value;
  const price = Array.isArray(first) ? Number(first[0]) : 0;
  const rows = items.filter((item) => item.seriesName !== "Precio actual").map((item) => { const value = Array.isArray(item.value) ? item.value : []; const modeled = Number(value[2]); return `${item.seriesName}: ${item.seriesName?.includes("acumulado") ? `${Number(value[1]).toFixed(1)}%` : `${Number(value[1]).toFixed(1)}% · ${compactMoney(modeled)}`}`; });
  return `<b>Precio ${compactPrice(price)}</b><br/>${rows.join("<br/>")}`;
}
function compactPrice(value: number): string { return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : 3 }).format(value); }
function compactMoney(value: number): string { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value); }
