"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chart, KLineData } from "klinecharts";
import type { EstimatedLiquidationZone } from "../../lib/market/engine/estimated-liquidations";
import {
  TRADING_INTERVALS,
  toKLinePeriod,
  type TradingInterval,
} from "../../lib/market/trading-candles";
import type { LiquidationEvent } from "../../lib/market/types";
import { useTradingCandles } from "../../lib/market/use-trading-candles";
import { TradingPriceAlerts } from "./trading-price-alerts";

const OVERLAY_INDICATORS = ["MA", "EMA", "SMA", "BOLL", "SAR", "AVP"] as const;
const PANE_INDICATORS = ["VOL", "RSI", "MACD", "KDJ", "CCI", "OBV", "WR"] as const;
const PARAMETER_DEFAULTS: Record<string, number[]> = {
  MA: [5, 10, 30, 60], EMA: [6, 12, 20], SMA: [12, 2], BOLL: [20, 2], SAR: [2, 2, 20],
  VOL: [5, 10, 20], RSI: [6, 12, 24], MACD: [12, 26, 9], KDJ: [9, 3, 3], CCI: [20], WR: [14, 6],
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const subscriptionRef = useRef<((data: KLineData) => void) | null>(null);
  const candlesRef = useRef<KLineData[]>([]);
  const feed = useTradingCandles(symbol, interval);
  const hasCandles = feed.candles.length > 0;
  const latestTimestamp = feed.candles.at(-1)?.timestamp;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("mi-indicators-v1") ?? "null") as { overlay?: string[]; panes?: string[]; params?: Record<string, number[]> } | null;
        if (saved) {
          if (Array.isArray(saved.overlay)) setOverlayIndicators(saved.overlay.filter((name) => OVERLAY_INDICATORS.some((item) => item === name)));
          if (Array.isArray(saved.panes)) setPaneIndicators(saved.panes.filter((name) => PANE_INDICATORS.some((item) => item === name)));
          if (saved.params && typeof saved.params === "object") setIndicatorParams(Object.fromEntries(Object.entries(saved.params).filter(([name, values]) => Array.isArray(values) && PARAMETER_DEFAULTS[name]?.length === values.length && values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 200))));
        }
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
    const chart = chartRef.current;
    const latest = feed.candles.at(-1);
    if (!chart || !latest) return;
    const chartData = chart.getDataList();
    if (chartData.length > 0 && feed.candles.length - chartData.length > 5) {
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

  function exportChart() {
    const url = chartRef.current?.getConvertPictureUrl(true, "png", "#070b12");
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
          <span className="section-kicker">PROFESSIONAL CHART · BYBIT PERPETUAL</span>
          <h2>{symbol.replace("USDT", "")}<em>/USDT</em></h2>
          <p>Histórico REST cacheado + vela actual por WebSocket. Zonas estimadas y liquidaciones observadas se dibujan sobre el precio.</p>
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
        <div className="trading-actions">
          <button type="button" onClick={() => chartRef.current?.scrollToRealTime(300)}>Ahora</button>
          <button type="button" onClick={exportChart}>PNG</button>
        </div>
      </div>

      <div className="trading-chart-layout">
        <div className="kline-stage">
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
      <TradingPriceAlerts key={`${symbol}-${interval}`} symbol={symbol} price={last?.close} live={feed.state === "live"} />
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
