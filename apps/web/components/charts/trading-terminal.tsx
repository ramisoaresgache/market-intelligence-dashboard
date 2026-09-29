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

const OVERLAY_INDICATORS = ["MA", "EMA", "BOLL"] as const;
const PANE_INDICATORS = ["VOL", "RSI", "MACD"] as const;

interface TradingTerminalProps {
  symbol: string;
  zones: EstimatedLiquidationZone[];
  liquidations: LiquidationEvent[];
}

export function TradingTerminal({ symbol, zones, liquidations }: TradingTerminalProps) {
  const [interval, setInterval] = useState<TradingInterval>("5m");
  const [overlayIndicators, setOverlayIndicators] = useState<string[]>(["MA"]);
  const [paneIndicators, setPaneIndicators] = useState<string[]>(["VOL", "RSI", "MACD"]);
  const [chartReady, setChartReady] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const subscriptionRef = useRef<((data: KLineData) => void) | null>(null);
  const candlesRef = useRef<KLineData[]>([]);
  const feed = useTradingCandles(symbol, interval);
  const hasCandles = feed.candles.length > 0;
  const latestTimestamp = feed.candles.at(-1)?.timestamp;

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
        chart.createIndicator({ name, paneId: "candle_pane" }, true);
      }
      for (const name of paneIndicators) chart.createIndicator(name);
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
  }, [hasCandles, interval, overlayIndicators, paneIndicators, symbol]);

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
        <div className="indicator-selector" aria-label="Indicadores de precio">
          {OVERLAY_INDICATORS.map((name) => (
            <button key={name} type="button" className={overlayIndicators.includes(name) ? "active" : ""} onClick={() => toggleOverlay(name)}>{name}</button>
          ))}
          <span />
          {PANE_INDICATORS.map((name) => (
            <button key={name} type="button" className={paneIndicators.includes(name) ? "active" : ""} onClick={() => togglePane(name)}>{name}</button>
          ))}
        </div>
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
          <div className="level-legend"><i className="long" />Long estimado<i className="short" />Short estimado</div>
          <div className="trading-level-list">
            {visibleZones.map((zone) => (
              <div key={zone.id}>
                <i className={zone.side} />
                <p><b>${formatPrice(zone.liquidationPrice)}</b><small>{zone.side} · {zone.leverage}x · {zone.confidence}</small></p>
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
