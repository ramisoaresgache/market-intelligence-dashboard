"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chart, KLineData, OverlayCreate } from "klinecharts";
import type { EstimatedLiquidationZone } from "../../lib/market/engine/estimated-liquidations";
import {
  TRADING_INTERVALS,
  toKLinePeriod,
  type TradingInterval,
} from "../../lib/market/trading-candles";
import type { LiquidationEvent } from "../../lib/market/types";
import { useTradingCandles } from "../../lib/market/use-trading-candles";
import { TradingPriceAlerts, type PriceAlert } from "./trading-price-alerts";

const OVERLAY_INDICATORS = ["MA", "EMA", "SMA", "BOLL", "SAR", "AVP"] as const;
const PANE_INDICATORS = ["VOL", "RSI", "MACD", "KDJ", "CCI", "OBV", "WR"] as const;
const PARAMETER_DEFAULTS: Record<string, number[]> = {
  MA: [5, 10, 30, 60], EMA: [6, 12, 20], SMA: [12, 2], BOLL: [20, 2], SAR: [2, 2, 20],
  VOL: [5, 10, 20], RSI: [6, 12, 24], MACD: [12, 26, 9], KDJ: [9, 3, 3], CCI: [20], WR: [14, 6],
};
const DRAWING_GROUP = "user-drawings";
const DRAWING_TOOLS = [
  { name: "segment", label: "Tendencia", key: "Alt+T" },
  { name: "straightLine", label: "Recta", key: "L" },
  { name: "rayLine", label: "Rayo", key: "R" },
  { name: "horizontalStraightLine", label: "Horizontal", key: "Alt+H" },
  { name: "verticalStraightLine", label: "Vertical", key: "Alt+V" },
  { name: "fibonacciLine", label: "Fibonacci", key: "Alt+F" },
  { name: "parallelStraightLine", label: "Paralelas", key: "P" },
  { name: "priceChannelLine", label: "Canal", key: "C" },
  { name: "brush", label: "Pincel", key: "B" },
  { name: "simpleAnnotation", label: "Nota", key: "N" },
] as const;
type DrawingName = (typeof DRAWING_TOOLS)[number]["name"];
type SavedDrawing = { id: string; name: DrawingName; points: Array<{ dataIndex?: number; timestamp?: number; value?: number }>; styles?: OverlayCreate["styles"]; extendData?: string; lock?: boolean; visible?: boolean };
type CandleAppearance = { up: string; down: string; background: string; type: "candle_solid" | "candle_stroke" | "candle_up_stroke" | "ohlc" | "area"; grid: boolean; drawColor: string; drawWidth: number };
const DEFAULT_APPEARANCE: CandleAppearance = { up: "#2ee6aa", down: "#ff5377", background: "#070b12", type: "candle_solid", grid: true, drawColor: "#46d8ed", drawWidth: 2 };
type SavedLayout = { id: string; name: string; symbol: string; interval: TradingInterval; appearance: CandleAppearance; overlays: string[]; panes: string[]; params: Record<string, number[]>; drawings: SavedDrawing[] };

interface TradingTerminalProps {
  symbol: string;
  zones: EstimatedLiquidationZone[];
  liquidations: LiquidationEvent[];
}

export function TradingTerminal({ symbol, zones, liquidations }: TradingTerminalProps) {
  const [interval, setInterval] = useState<TradingInterval>("5m");
  const [overlayIndicators, setOverlayIndicators] = useState<string[]>(["MA"]);
  const [paneIndicators, setPaneIndicators] = useState<string[]>(["VOL", "RSI", "MACD"]);
  const [indicatorParams, setIndicatorParams] = useState<Record<string, number[]>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedIndicator, setSelectedIndicator] = useState("MA");
  const [parameterDraft, setParameterDraft] = useState("5, 10, 30, 60");
  const [parameterError, setParameterError] = useState("");
  const [chartReady, setChartReady] = useState(0);
  const [appearance, setAppearance] = useState<CandleAppearance>(DEFAULT_APPEARANCE);
  const [activeTool, setActiveTool] = useState<DrawingName | null>(null);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [drawings, setDrawings] = useState<SavedDrawing[]>([]);
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [layoutName, setLayoutName] = useState("");
  const [alertRequest, setAlertRequest] = useState(0);
  const [alertLevels, setAlertLevels] = useState<PriceAlert[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const activeOverlayRef = useRef<string | null>(null);
  const undoRef = useRef<SavedDrawing[][]>([]);
  const redoRef = useRef<SavedDrawing[][]>([]);
  const subscriptionRef = useRef<((data: KLineData) => void) | null>(null);
  const candlesRef = useRef<KLineData[]>([]);
  const feed = useTradingCandles(symbol, interval);
  const hasCandles = feed.candles.length > 0;
  const latestTimestamp = feed.candles.at(-1)?.timestamp;
  const updateAlertLevels = useCallback((alerts: PriceAlert[]) => setAlertLevels(alerts), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("mi-indicators-v1") ?? "null") as { overlay?: string[]; panes?: string[]; params?: Record<string, number[]> } | null;
        if (saved) {
          if (Array.isArray(saved.overlay)) setOverlayIndicators(saved.overlay.filter((name) => OVERLAY_INDICATORS.some((item) => item === name)));
          if (Array.isArray(saved.panes)) setPaneIndicators(saved.panes.filter((name) => PANE_INDICATORS.some((item) => item === name)));
          if (saved.params && typeof saved.params === "object") setIndicatorParams(Object.fromEntries(Object.entries(saved.params).filter(([name, values]) => Array.isArray(values) && PARAMETER_DEFAULTS[name]?.length === values.length && values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 200))));
        }
        const appearanceRaw = JSON.parse(localStorage.getItem("mi-chart-appearance-v1") ?? "null") as unknown;
        if (isAppearance(appearanceRaw)) setAppearance(appearanceRaw);
        const layoutsRaw = JSON.parse(localStorage.getItem("mi-chart-layouts-v1") ?? "[]") as unknown;
        if (Array.isArray(layoutsRaw)) setLayouts(layoutsRaw.filter(isSavedLayout).slice(0, 20));
      } catch { /* Invalid local preference: use defaults. */ }
      setSettingsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("mi-indicators-v1", JSON.stringify({ overlay: overlayIndicators, panes: paneIndicators, params: indicatorParams }));
  }, [indicatorParams, overlayIndicators, paneIndicators, settingsLoaded]);

  useEffect(() => {
    if (settingsLoaded) localStorage.setItem("mi-chart-appearance-v1", JSON.stringify(appearance));
  }, [appearance, settingsLoaded]);

  useEffect(() => {
    if (settingsLoaded) localStorage.setItem("mi-chart-layouts-v1", JSON.stringify(layouts));
  }, [layouts, settingsLoaded]);

  useEffect(() => {
    candlesRef.current = feed.candles;
  }, [feed.candles]);

  const visibleZones = useMemo(
    () => [...zones]
      .filter((zone) => Number.isFinite(zone.liquidationPrice) && zone.exposure > 0)
      .sort((left, right) => right.exposure - left.exposure)
      .slice(0, 8),
    [zones],
  );
  const visibleEvents = useMemo(
    () => liquidations.filter((event) => event.symbol === symbol).slice(-14),
    [liquidations, symbol],
  );

  useEffect(() => {
    if (!containerRef.current || !hasCandles) return;
    let disposed = false;
    let localChart: Chart | null = null;

    void import("klinecharts").then(({ init }) => {
      if (disposed || !containerRef.current) return;
      const chart = init(containerRef.current, {
        locale: "en-US",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        styles: {
          grid: {
            horizontal: { color: "rgba(87, 105, 129, .16)" },
            vertical: { color: "rgba(87, 105, 129, .12)" },
          },
          candle: {
            bar: {
              upColor: "#2ee6aa",
              downColor: "#ff5377",
              noChangeColor: "#8290a4",
              upBorderColor: "#2ee6aa",
              downBorderColor: "#ff5377",
              noChangeBorderColor: "#8290a4",
              upWickColor: "#2ee6aa",
              downWickColor: "#ff5377",
              noChangeWickColor: "#8290a4",
            },
            priceMark: {
              high: { color: "#9aa8ba" },
              low: { color: "#9aa8ba" },
              last: {
                upColor: "#2ee6aa",
                downColor: "#ff5377",
                noChangeColor: "#8290a4",
              },
            },
          },
          xAxis: {
            axisLine: { color: "#243143" },
            tickLine: { color: "#243143" },
            tickText: { color: "#728299" },
          },
          yAxis: {
            axisLine: { color: "#243143" },
            tickLine: { color: "#243143" },
            tickText: { color: "#728299" },
          },
          separator: { color: "#1b2736", activeBackgroundColor: "rgba(31,214,228,.08)" },
          crosshair: {
            horizontal: { line: { color: "#6f8096" }, text: { backgroundColor: "#263548" } },
            vertical: { line: { color: "#6f8096" }, text: { backgroundColor: "#263548" } },
          },
        },
      });
      if (!chart) return;
      localChart = chart;
      chartRef.current = chart;
      chart.setDataLoader({
        getBars: ({ callback }) => callback(candlesRef.current, false),
        subscribeBar: ({ callback }) => {
          subscriptionRef.current = callback;
        },
        unsubscribeBar: () => {
          subscriptionRef.current = null;
        },
      });
      const latest = candlesRef.current.at(-1)?.close ?? 1;
      chart.setSymbol({
        ticker: symbol,
        pricePrecision: pricePrecision(latest),
        volumePrecision: 3,
      });
      chart.setPeriod(toKLinePeriod(interval));
      for (const name of overlayIndicators) {
        chart.createIndicator({ name, paneId: "candle_pane", ...(indicatorParams[name] ? { calcParams: indicatorParams[name] } : {}) }, true);
      }
      for (const name of paneIndicators) chart.createIndicator({ name, ...(indicatorParams[name] ? { calcParams: indicatorParams[name] } : {}) });
      undoRef.current = [];
      redoRef.current = [];
      const chartCallbacks = {
        save: () => {
          const drawings = snapshotDrawings(chart);
          writeSavedDrawings(symbol, interval, drawings);
          setDrawingCount(drawings.length);
          setDrawings(drawings);
        },
        select: setSelectedDrawing,
        record: (previous: SavedDrawing[]) => {
          undoRef.current = [...undoRef.current.slice(-39), previous];
          redoRef.current = [];
        },
        finish: () => { activeOverlayRef.current = null; setActiveTool(null); },
      };
      for (const drawing of readSavedDrawings(symbol, interval)) {
        chart.createOverlay(userOverlayOptions(chart, drawing.name, drawing.id, DEFAULT_APPEARANCE, chartCallbacks, drawing));
      }
      const restored = snapshotDrawings(chart);
      setDrawingCount(restored.length);
      setDrawings(restored);
      chart.setOffsetRightDistance(70);
      chart.scrollToRealTime();
      setChartReady((current) => current + 1);

      const resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);
      Object.assign(chart, { __resizeObserver: resizeObserver });

    });

    return () => {
      disposed = true;
      subscriptionRef.current = null;
      const resizeObserver = (localChart as (Chart & { __resizeObserver?: ResizeObserver }) | null)?.__resizeObserver;
      resizeObserver?.disconnect();
      if (localChart) {
        import("klinecharts").then(({ dispose }) => dispose(localChart!));
      }
      if (chartRef.current === localChart) chartRef.current = null;
    };
  }, [hasCandles, indicatorParams, interval, overlayIndicators, paneIndicators, symbol]);

  useEffect(() => {
    chartRef.current?.setStyles({
      grid: { show: appearance.grid },
      candle: { type: appearance.type, bar: {
        upColor: appearance.up, upBorderColor: appearance.up, upWickColor: appearance.up,
        downColor: appearance.down, downBorderColor: appearance.down, downWickColor: appearance.down,
      }, priceMark: { last: { upColor: appearance.up, downColor: appearance.down } } },
    });
  }, [appearance, chartReady]);

  useEffect(() => {
    const chart = chartRef.current;
    const latest = feed.candles.at(-1);
    if (!chart || !latest) return;
    const chartData = chart.getDataList();
    if (chartData.length > 0 && (Math.abs(feed.candles.length - chartData.length) > 5 || chartData[0]?.timestamp !== feed.candles[0]?.timestamp)) {
      chart.resetData();
      return;
    }
    subscriptionRef.current?.(latest);
  }, [feed.candles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || latestTimestamp == null) return;
    chart.removeOverlay({ groupId: "liquidation-zones" });
    chart.createOverlay(visibleZones.map((zone) => ({
      name: "horizontalStraightLine",
      groupId: "liquidation-zones",
      lock: true,
      zLevel: 5,
      points: [{ timestamp: latestTimestamp, value: zone.liquidationPrice }],
      styles: {
        line: {
          color: zone.side === "long" ? "rgba(255,83,119,.62)" : "rgba(46,230,170,.62)",
          size: zone.confidence === "medium" ? 1.35 : 1,
          style: zone.confidence === "medium" ? "solid" : "dashed",
        },
      },
    })));
  }, [chartReady, latestTimestamp, visibleZones]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.removeOverlay({ groupId: "observed-liquidations" });
    chart.createOverlay(visibleEvents.map((event) => ({
      name: "simpleAnnotation",
      groupId: "observed-liquidations",
      lock: true,
      zLevel: 8,
      points: [{ timestamp: event.ts, value: event.price }],
      extendData: `${event.side === "long" ? "L" : "S"} ${compactMoney(event.notional)}`,
      styles: {
        line: { color: event.side === "long" ? "#ff5377" : "#2ee6aa", size: 1 },
        text: {
          color: "#e9f1fb",
          backgroundColor: event.side === "long" ? "rgba(143,36,61,.92)" : "rgba(20,103,79,.92)",
          size: 9,
        },
      },
    })));
  }, [chartReady, visibleEvents]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || latestTimestamp == null) return;
    chart.removeOverlay({ groupId: "price-alerts" });
    chart.createOverlay(alertLevels.map((alert) => ({
      name: "horizontalStraightLine",
      groupId: "price-alerts",
      lock: true,
      zLevel: 7,
      points: [{ timestamp: latestTimestamp, value: alert.target }],
      styles: { line: { color: alert.firedAt ? "#76869c" : alert.direction === "above" ? "#f2ce58" : "#46d8ed", size: 1, style: "dashed" } },
    })));
  }, [alertLevels, chartReady, latestTimestamp]);

  function toggleOverlay(name: string) {
    setOverlayIndicators((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }

  function togglePane(name: string) {
    setPaneIndicators((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }

  function selectIndicator(name: string) {
    setSelectedIndicator(name);
    setParameterDraft((indicatorParams[name] ?? PARAMETER_DEFAULTS[name] ?? []).join(", "));
    setParameterError("");
  }

  function saveParameters() {
    const values = parameterDraft.split(",").map((value) => Number(value.trim()));
    const defaults = PARAMETER_DEFAULTS[selectedIndicator];
    if (!defaults || values.length !== defaults.length || values.some((value) => !Number.isFinite(value) || value <= 0 || value > 200)) {
      setParameterError(`Ingresá ${defaults?.length ?? 0} números entre 1 y 200, separados por comas.`);
      return;
    }
    setIndicatorParams((current) => ({ ...current, [selectedIndicator]: values }));
    setParameterError("");
  }

  function recordHistory(previous: SavedDrawing[]) {
    undoRef.current = [...undoRef.current.slice(-39), previous];
    redoRef.current = [];
  }

  function syncDrawings(chart: Chart) {
    const drawings = snapshotDrawings(chart);
    writeSavedDrawings(symbol, interval, drawings);
    setDrawingCount(drawings.length);
    setDrawings(drawings);
  }

  function restoreDrawings(chart: Chart, drawings: SavedDrawing[]) {
    chart.removeOverlay({ groupId: DRAWING_GROUP });
    for (const drawing of drawings) chart.createOverlay(userOverlayOptions(chart, drawing.name, drawing.id, appearance, {
      save: () => syncDrawings(chart), select: setSelectedDrawing, record: recordHistory, finish: () => setActiveTool(null),
    }, drawing));
    syncDrawings(chart);
    setSelectedDrawing(null);
    setActiveTool(null);
  }

  function startDrawing(name: DrawingName) {
    const chart = chartRef.current;
    if (!chart) return;
    if (activeOverlayRef.current) chart.removeOverlay({ id: activeOverlayRef.current });
    const id = crypto.randomUUID();
    const note = name === "simpleAnnotation" ? window.prompt("Texto de la nota", "Nota")?.trim().slice(0, 80) : undefined;
    if (name === "simpleAnnotation" && !note) return;
    activeOverlayRef.current = id;
    setActiveTool(name);
    setSelectedDrawing(null);
    chart.createOverlay(userOverlayOptions(chart, name, id, appearance, {
      save: () => syncDrawings(chart), select: setSelectedDrawing, record: recordHistory, finish: () => { activeOverlayRef.current = null; setActiveTool(null); },
    }, note ? { id, name, points: [], extendData: note } : undefined));
  }

  function removeSelectedDrawing() {
    const chart = chartRef.current;
    if (!chart || !selectedDrawing) return;
    recordHistory(snapshotDrawings(chart));
    chart.removeOverlay({ id: selectedDrawing });
    syncDrawings(chart);
    setSelectedDrawing(null);
  }

  function clearDrawings() {
    const chart = chartRef.current;
    if (!chart || !chart.getOverlays({ groupId: DRAWING_GROUP }).length) return;
    if (!window.confirm("¿Eliminar todos los dibujos de este activo e intervalo?")) return;
    recordHistory(snapshotDrawings(chart));
    restoreDrawings(chart, []);
  }

  function updateSelectedDrawing(override: Partial<OverlayCreate>) {
    const chart = chartRef.current;
    if (!chart || !selectedDrawing) return;
    recordHistory(snapshotDrawings(chart));
    chart.overrideOverlay({ id: selectedDrawing, ...override });
    syncDrawings(chart);
  }

  function duplicateSelectedDrawing() {
    const chart = chartRef.current;
    const original = drawings.find((drawing) => drawing.id === selectedDrawing);
    if (!chart || !original) return;
    recordHistory(snapshotDrawings(chart));
    const duplicate = { ...original, id: crypto.randomUUID() };
    chart.createOverlay(userOverlayOptions(chart, duplicate.name, duplicate.id, appearance, {
      save: () => syncDrawings(chart), select: setSelectedDrawing, record: recordHistory, finish: () => setActiveTool(null),
    }, duplicate));
    syncDrawings(chart);
    setSelectedDrawing(duplicate.id);
  }

  function undoDrawing() {
    const chart = chartRef.current;
    const previous = undoRef.current.pop();
    if (!chart || !previous) return;
    redoRef.current.push(snapshotDrawings(chart));
    restoreDrawings(chart, previous);
  }

  function redoDrawing() {
    const chart = chartRef.current;
    const next = redoRef.current.pop();
    if (!chart || !next) return;
    undoRef.current.push(snapshotDrawings(chart));
    restoreDrawings(chart, next);
  }

  function saveLayout() {
    const chart = chartRef.current;
    if (!chart) return;
    const name = layoutName.trim().slice(0, 40) || `Diseño ${new Date().toLocaleString("es-AR")}`;
    const layout: SavedLayout = { id: crypto.randomUUID(), name, symbol, interval, appearance, overlays: overlayIndicators, panes: paneIndicators, params: indicatorParams, drawings: snapshotDrawings(chart) };
    setLayouts((current) => [...current.slice(-19), layout]);
    setLayoutName("");
  }

  function applyLayout(layout: SavedLayout) {
    writeSavedDrawings(symbol, layout.interval, layout.drawings);
    setAppearance(layout.appearance);
    setOverlayIndicators(layout.overlays);
    setPaneIndicators(layout.panes);
    setIndicatorParams(layout.params);
    setInterval(layout.interval);
    if (interval === layout.interval && chartRef.current) restoreDrawings(chartRef.current, layout.drawings);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))) return;
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redoDrawing(); else undoDrawing(); }
        if (event.key.toLowerCase() === "y") { event.preventDefault(); redoDrawing(); }
        if (event.key.toLowerCase() === "s") { event.preventDefault(); saveLayout(); }
        return;
      }
      const pressed = `${event.altKey ? "Alt+" : ""}${event.key}`.toLowerCase();
      const tool = DRAWING_TOOLS.find((item) => item.key.toLowerCase() === pressed);
      if (tool) { event.preventDefault(); startDrawing(tool.name); return; }
      if (event.altKey) return;
      if (event.key === "Delete" || event.key === "Backspace") { removeSelectedDrawing(); return; }
      if (event.key === "Escape") {
        if (activeOverlayRef.current) chartRef.current?.removeOverlay({ id: activeOverlayRef.current });
        activeOverlayRef.current = null;
        setActiveTool(null);
        setSelectedDrawing(null);
        return;
      }
      if (event.key.toLowerCase() === "a") { setAlertRequest((current) => current + 1); return; }
      if (event.key === "+" || event.key === "=") { chartRef.current?.zoomAtCoordinate(1.2); return; }
      if (event.key === "-") chartRef.current?.zoomAtCoordinate(0.8);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function exportChart() {
    const url = chartRef.current?.getConvertPictureUrl(true, "png", appearance.background);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol}-${interval}-${Date.now()}.png`;
    link.click();
  }

  const last = feed.candles.at(-1);
  const change = last ? ((last.close - last.open) / last.open) * 100 : null;

  return (
    <section className="trading-terminal section-view">
      <header className="trading-terminal-head">
        <div>
          <span className="section-kicker">PROFESSIONAL CHART · BINGX PERPETUAL{feed.historySource && feed.historySource !== "bingx" ? ` · RESPALDO ${feed.historySource.toUpperCase()}` : ""}</span>
          <h2>{symbol.replace("USDT", "")}<em>/USDT</em></h2>
          <p>Velas BingX REST + WebSocket. Dibujos y diseños se guardan en este navegador; los niveles de liquidación son una capa analítica separada.</p>
        </div>
        <div className="trading-live-summary">
          <span className={`trading-feed-state ${feed.state}`}><i />{feed.state}</span>
          <b>{last ? `$${formatPrice(last.close)}` : "—"}</b>
          <small className={change != null && change < 0 ? "negative" : "positive"}>
            {change == null ? "esperando vela" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% en vela`}
          </small>
        </div>
      </header>

      <div className="trading-toolbar">
        <div className="timeframe-selector" aria-label="Timeframe">
          {TRADING_INTERVALS.map((value) => (
            <button key={value} type="button" className={interval === value ? "active" : ""} onClick={() => setInterval(value)}>
              {value === "1d" ? "1D" : value}
            </button>
          ))}
        </div>
        <details className="indicator-menu"><summary>Indicadores ({overlayIndicators.length + paneIndicators.length})</summary>
          <div className="indicator-menu-content">
            <strong>Sobre el precio</strong><div className="indicator-menu-grid">{OVERLAY_INDICATORS.map((name) => <button key={name} type="button" className={overlayIndicators.includes(name) ? "active" : ""} onClick={() => toggleOverlay(name)}>{name}</button>)}</div>
            <strong>Paneles</strong><div className="indicator-menu-grid">{PANE_INDICATORS.map((name) => <button key={name} type="button" className={paneIndicators.includes(name) ? "active" : ""} onClick={() => togglePane(name)}>{name}</button>)}</div>
            <strong>Parámetros</strong><div className="indicator-parameters"><select aria-label="Indicador a configurar" value={selectedIndicator} onChange={(event) => selectIndicator(event.target.value)}>{Object.keys(PARAMETER_DEFAULTS).map((name) => <option key={name}>{name}</option>)}</select><input aria-label="Períodos del indicador" value={parameterDraft} onChange={(event) => setParameterDraft(event.target.value)} placeholder="5, 10, 30, 60" /><button type="button" onClick={saveParameters}>Aplicar</button></div>
            {parameterError ? <small className="indicator-error">{parameterError}</small> : <small className="indicator-note">Los indicadores y períodos quedan guardados en este navegador. Tus scripts Pine se podrán portar cuando compartas sus fórmulas.</small>}
          </div>
        </details>
        <details className="indicator-menu appearance-menu"><summary>Apariencia</summary>
          <div className="indicator-menu-content appearance-menu-content">
            <strong>Tipo de gráfico</strong>
            <select aria-label="Tipo de gráfico" value={appearance.type} onChange={(event) => setAppearance((current) => ({ ...current, type: event.target.value as CandleAppearance["type"] }))}>
              <option value="candle_solid">Velas sólidas</option><option value="candle_stroke">Velas huecas</option><option value="candle_up_stroke">Alcistas huecas</option><option value="ohlc">Barras OHLC</option><option value="area">Área</option>
            </select>
            <div className="appearance-colors"><label>Alcista<input type="color" value={appearance.up} onChange={(event) => setAppearance((current) => ({ ...current, up: event.target.value }))} /></label><label>Bajista<input type="color" value={appearance.down} onChange={(event) => setAppearance((current) => ({ ...current, down: event.target.value }))} /></label><label>Fondo<input type="color" value={appearance.background} onChange={(event) => setAppearance((current) => ({ ...current, background: event.target.value }))} /></label><label>Dibujos<input type="color" value={appearance.drawColor} onChange={(event) => setAppearance((current) => ({ ...current, drawColor: event.target.value }))} /></label></div>
            <label className="appearance-check"><input type="checkbox" checked={appearance.grid} onChange={(event) => setAppearance((current) => ({ ...current, grid: event.target.checked }))} /> Mostrar cuadrícula</label>
            <label className="appearance-check">Trazo <input type="range" min="1" max="5" value={appearance.drawWidth} onChange={(event) => setAppearance((current) => ({ ...current, drawWidth: Number(event.target.value) }))} /> {appearance.drawWidth}px</label>
            <button type="button" onClick={() => setAppearance(DEFAULT_APPEARANCE)}>Restablecer colores</button>
          </div>
        </details>
        <details className="indicator-menu layout-menu"><summary>Diseños ({layouts.filter((item) => item.symbol === symbol).length})</summary>
          <div className="indicator-menu-content layout-menu-content">
            <strong>Guardar configuración y dibujos</strong>
            <div className="indicator-parameters"><input aria-label="Nombre del diseño" value={layoutName} maxLength={40} onChange={(event) => setLayoutName(event.target.value)} placeholder="Nombre del diseño" /><button type="button" onClick={saveLayout}>Guardar</button></div>
            {layouts.filter((item) => item.symbol === symbol).map((layout) => <div className="layout-entry" key={layout.id}><button type="button" onClick={() => applyLayout(layout)}>{layout.name} <small>{layout.interval}</small></button><button type="button" aria-label={`Eliminar diseño ${layout.name}`} onClick={() => setLayouts((current) => current.filter((item) => item.id !== layout.id))}>×</button></div>)}
            <small className="indicator-note">Hasta 20 diseños, guardados solo en este navegador.</small>
          </div>
        </details>
        <div className="trading-actions">
          <button type="button" onClick={() => setAlertRequest((current) => current + 1)}>＋ Alerta <kbd>A</kbd></button>
          <button type="button" onClick={() => chartRef.current?.scrollToRealTime(300)}>Ahora</button>
          <button type="button" onClick={exportChart}>PNG</button>
        </div>
      </div>

      {selectedDrawing && drawings.some((drawing) => drawing.id === selectedDrawing) ? <div className="selected-drawing-bar">
        <strong>{DRAWING_TOOLS.find((tool) => tool.name === drawings.find((drawing) => drawing.id === selectedDrawing)?.name)?.label ?? "Dibujo"}</strong>
        <label>Color<input type="color" value={drawingColor(drawings.find((drawing) => drawing.id === selectedDrawing), appearance.drawColor)} onChange={(event) => updateSelectedDrawing({ styles: { line: { color: event.target.value }, text: { color: event.target.value } } })} /></label>
        <label>Grosor<input type="range" min="1" max="5" value={drawingWidth(drawings.find((drawing) => drawing.id === selectedDrawing), appearance.drawWidth)} onChange={(event) => updateSelectedDrawing({ styles: { line: { size: Number(event.target.value) } } })} /></label>
        <button type="button" onClick={() => updateSelectedDrawing({ lock: !drawings.find((drawing) => drawing.id === selectedDrawing)?.lock })}>{drawings.find((drawing) => drawing.id === selectedDrawing)?.lock ? "Desbloquear" : "Bloquear"}</button>
        <button type="button" onClick={duplicateSelectedDrawing}>Duplicar</button>
        <button type="button" onClick={removeSelectedDrawing}>Eliminar</button>
      </div> : null}

      <div className="trading-chart-layout">
        <div className="kline-stage" style={{ background: appearance.background }}>
          <nav className="drawing-rail" aria-label="Herramientas de dibujo">
            {DRAWING_TOOLS.map((tool) => <button key={tool.name} type="button" title={`${tool.label} (${tool.key})`} aria-label={`${tool.label} (${tool.key})`} className={activeTool === tool.name ? "active" : ""} onClick={() => startDrawing(tool.name)}><span>{drawingIcon(tool.name)}</span><small>{tool.label}</small></button>)}
            <span className="drawing-rail-divider" />
            <button type="button" title="Deshacer (Ctrl+Z)" aria-label="Deshacer dibujo" onClick={undoDrawing}>↶</button>
            <button type="button" title="Rehacer (Ctrl+Y)" aria-label="Rehacer dibujo" onClick={redoDrawing}>↷</button>
            <button type="button" title="Eliminar dibujo seleccionado (Supr)" aria-label="Eliminar dibujo seleccionado" disabled={!selectedDrawing} onClick={removeSelectedDrawing}>⌫</button>
            <button type="button" title="Eliminar todos los dibujos" aria-label="Eliminar todos los dibujos" disabled={!drawingCount} onClick={clearDrawings}>♲</button>
          </nav>
          <div ref={containerRef} className="kline-chart" aria-label={`Gráfico de velas ${symbol} ${interval}`} />
          {!feed.candles.length ? <div className="kline-loading"><span className="pulse-dot" />Cargando velas…</div> : null}
        </div>
        <aside className="trading-levels">
          <header><span>NIVELES EN EL GRÁFICO</span><b>{visibleZones.length + visibleEvents.length}</b></header>
          <div className="level-legend"><i className="long" />Cierre long estimado<i className="short" />Cierre short estimado</div>
          <div className="trading-level-list">
            {visibleZones.map((zone) => (
              <div key={zone.id}>
                <i className={zone.side} />
                <p><b>${formatPrice(zone.liquidationPrice)}</b><small>Cierre {zone.side} · escenario {zone.leverage}x · confianza {zone.confidence === "medium" ? "media" : "baja"}</small></p>
                <em>{compactMoney(zone.exposure)}</em>
              </div>
            ))}
            {!visibleZones.length ? <p className="levels-empty">El modelo necesita cambios de interés abierto para formar zonas.</p> : null}
          </div>
          <footer>
            <span>HISTÓRICO</span><b>{feed.historySource?.toUpperCase() ?? "CACHE"}</b>
            <span>VELAS</span><b>{feed.candles.length}</b>
          </footer>
          {feed.error ? <p className="trading-warning">{feed.error}</p> : null}
        </aside>
      </div>
      <div className="trading-chart-status"><span>{activeTool ? `Dibujá: ${DRAWING_TOOLS.find((tool) => tool.name === activeTool)?.label}` : selectedDrawing ? "Dibujo seleccionado · arrastrá para editar o Supr para borrar" : "Elegí una herramienta para dibujar"}</span><span>{drawingCount} dibujos · {feed.historySource?.toUpperCase() ?? "CACHÉ"} · <kbd>Ctrl+Z</kbd> deshacer · <kbd>A</kbd> alerta · <kbd>+ / −</kbd> zoom</span></div>
      <TradingPriceAlerts key={symbol} symbol={symbol} price={last?.close} live={feed.state === "live" || feed.state === "polling"} requestFocus={alertRequest} onAlertsChange={updateAlertLevels} />
      <p className="trading-disclaimer">Las líneas de liquidación son estimaciones analíticas, no posiciones reportadas por los exchanges. Los marcadores L/S sí representan eventos observados en los feeds públicos disponibles.</p>
    </section>
  );
}

function pricePrecision(value: number): number {
  if (value >= 1_000) return 2;
  if (value >= 1) return 3;
  return 5;
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: pricePrecision(value), maximumFractionDigits: pricePrecision(value) });
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function drawingIcon(name: DrawingName): string {
  const icons: Record<DrawingName, string> = { segment: "╱", straightLine: "⟋", rayLine: "↗", horizontalStraightLine: "━", verticalStraightLine: "┃", fibonacciLine: "≋", parallelStraightLine: "∥", priceChannelLine: "▱", brush: "✎", simpleAnnotation: "T" };
  return icons[name];
}

function snapshotDrawings(chart: Chart): SavedDrawing[] {
  return chart.getOverlays({ groupId: DRAWING_GROUP }).flatMap((overlay) => {
    if (!DRAWING_TOOLS.some((tool) => tool.name === overlay.name) || !overlay.points.length) return [];
    return [{
      id: overlay.id,
      name: overlay.name as DrawingName,
      points: overlay.points.map((point) => ({ ...(point.dataIndex != null ? { dataIndex: point.dataIndex } : {}), ...(point.timestamp != null ? { timestamp: point.timestamp } : {}), ...(point.value != null ? { value: point.value } : {}) })),
      ...(overlay.styles ? { styles: overlay.styles } : {}),
      ...(typeof overlay.extendData === "string" ? { extendData: overlay.extendData } : {}),
      lock: overlay.lock,
      visible: overlay.visible,
    }];
  });
}

function userOverlayOptions(
  chart: Chart,
  name: DrawingName,
  id: string,
  appearance: CandleAppearance,
  callbacks: { save: () => void; select: (id: string | null) => void; record: (previous: SavedDrawing[]) => void; finish: () => void },
  saved?: SavedDrawing,
): OverlayCreate {
  let beforeMove: SavedDrawing[] | null = null;
  return {
    id, name, groupId: DRAWING_GROUP, paneId: "candle_pane", zLevel: 10,
    ...(saved?.lock !== undefined ? { lock: saved.lock } : {}),
    ...(saved?.visible !== undefined ? { visible: saved.visible } : {}),
    ...(saved?.points.length ? { points: saved.points } : {}),
    ...(saved?.extendData ? { extendData: saved.extendData } : {}),
    styles: saved?.styles ?? { line: { color: appearance.drawColor, size: appearance.drawWidth }, text: { color: appearance.drawColor } },
    onDrawEnd: () => {
      callbacks.record(snapshotDrawings(chart).filter((drawing) => drawing.id !== id));
      callbacks.save();
      callbacks.select(id);
      callbacks.finish();
    },
    onPressedMoveStart: () => { beforeMove = snapshotDrawings(chart); },
    onPressedMoveEnd: () => {
      if (beforeMove) callbacks.record(beforeMove);
      beforeMove = null;
      callbacks.save();
    },
    onClick: () => callbacks.select(id),
    onSelected: () => callbacks.select(id),
  };
}

function drawingStorageKey(symbol: string, interval: TradingInterval): string {
  return `mi-drawings-v1:${symbol}:${interval}`;
}

function readSavedDrawings(symbol: string, interval: TradingInterval): SavedDrawing[] {
  try {
    const value = JSON.parse(localStorage.getItem(drawingStorageKey(symbol, interval)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isSavedDrawing).slice(0, 200) : [];
  } catch { return []; }
}

function writeSavedDrawings(symbol: string, interval: TradingInterval, drawings: SavedDrawing[]) {
  try { localStorage.setItem(drawingStorageKey(symbol, interval), JSON.stringify(drawings.slice(0, 200))); }
  catch { /* Storage may be unavailable or full; the current chart stays usable. */ }
}

function isSavedDrawing(value: unknown): value is SavedDrawing {
  if (!value || typeof value !== "object") return false;
  const drawing = value as Partial<SavedDrawing>;
  return typeof drawing.id === "string" && drawing.id.length < 100
    && DRAWING_TOOLS.some((tool) => tool.name === drawing.name)
    && (drawing.lock === undefined || typeof drawing.lock === "boolean")
    && (drawing.visible === undefined || typeof drawing.visible === "boolean")
    && Array.isArray(drawing.points) && drawing.points.length <= 5_000
    && drawing.points.every((point) => point && typeof point === "object" && (point.dataIndex === undefined || Number.isFinite(point.dataIndex)) && (point.timestamp === undefined || Number.isFinite(point.timestamp)) && (point.value === undefined || Number.isFinite(point.value)));
}

function drawingColor(drawing: SavedDrawing | undefined, fallback: string): string {
  const color = drawing?.styles?.line?.color;
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function drawingWidth(drawing: SavedDrawing | undefined, fallback: number): number {
  const size = drawing?.styles?.line?.size;
  return typeof size === "number" && size >= 1 && size <= 5 ? size : fallback;
}

function isAppearance(value: unknown): value is CandleAppearance {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CandleAppearance>;
  return [item.up, item.down, item.background, item.drawColor].every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
    && ["candle_solid", "candle_stroke", "candle_up_stroke", "ohlc", "area"].includes(item.type ?? "")
    && typeof item.grid === "boolean" && typeof item.drawWidth === "number" && item.drawWidth >= 1 && item.drawWidth <= 5;
}

function isSavedLayout(value: unknown): value is SavedLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<SavedLayout>;
  return typeof layout.id === "string" && typeof layout.name === "string" && typeof layout.symbol === "string"
    && TRADING_INTERVALS.some((item) => item === layout.interval) && isAppearance(layout.appearance)
    && Array.isArray(layout.overlays) && layout.overlays.every((name) => OVERLAY_INDICATORS.some((item) => item === name))
    && Array.isArray(layout.panes) && layout.panes.every((name) => PANE_INDICATORS.some((item) => item === name))
    && typeof layout.params === "object" && layout.params !== null
    && Array.isArray(layout.drawings) && layout.drawings.every(isSavedDrawing);
}
