"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MARKET_SESSIONS, marketSessionState } from "../lib/market/market-sessions";
import { useEChart } from "./charts/use-echart";

type DailyPayload = {
  source: string;
  open: number;
  close: number;
  changeUsd: number;
  changePct: number;
  currentDayStart: number;
  currentDayOpen: number;
  currentDayChangeUsd: number;
  currentDayChangePct: number;
  points: Array<{ ts: number; price: number; open?: number }>;
};

const subscribeToHydration = () => () => undefined;

export function MarketPulse({ symbol, currentPrice }: { symbol: string; currentPrice?: number | null }) {
  const [request, setRequest] = useState<{ symbol: string; data: DailyPayload | null; error: string | null }>({ symbol: "", data: null, error: null });
  const [clock, setClock] = useState(() => Date.now());
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/market-daily?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as DailyPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      })
      .then((data) => { if (!controller.signal.aborted) setRequest({ symbol, data, error: null }); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setRequest({ symbol, data: null, error: reason instanceof Error ? reason.message : "Histórico no disponible" }); });
    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const data = request.symbol === symbol ? request.data : null;
  const error = request.symbol === symbol ? request.error : null;
  const latest = currentPrice ?? data?.close;
  const changeUsd = latest != null && data?.open != null ? latest - data.open : data?.changeUsd;
  const changePct = latest != null && data?.open ? ((latest - data.open) / data.open) * 100 : data?.changePct;
  const tone = (changeUsd ?? 0) >= 0 ? "positive" : "negative";
  const currentDayChangeUsd = latest != null && data?.currentDayOpen != null
    ? latest - data.currentDayOpen
    : data?.currentDayChangeUsd;
  const currentDayChangePct = latest != null && data?.currentDayOpen
    ? ((latest - data.currentDayOpen) / data.currentDayOpen) * 100
    : data?.currentDayChangePct;
  const currentDayTone = (currentDayChangeUsd ?? 0) >= 0 ? "positive" : "negative";
  const option = useMemo(() => pulseOption(data?.points ?? [], tone), [data?.points, tone]);
  const { containerRef, exportPng } = useEChart(option);
  const sessions = MARKET_SESSIONS.map((session) => ({ ...session, ...(hydrated ? marketSessionState(clock, session) : { open: false, localTime: "—", utcHours: "—" }) }));
  const activeCount = sessions.filter((session) => session.open).length;

  return <section className="market-pulse" aria-label="Movimiento de mercado y sesiones activas">
    <div className="market-pulse-main">
      <div className="market-pulse-heading">
        <div><span>MOVIMIENTO 24 H</span><strong className={tone}>{signedPercent(changePct)}</strong></div>
        <div className="market-pulse-change"><span>CAMBIO</span><b className={tone}>{signedMoney(changeUsd)}</b></div>
        <button type="button" onClick={() => exportPng(`${symbol}-24h.png`)} aria-label="Exportar movimiento 24 horas">PNG</button>
      </div>
      <div ref={containerRef} className="market-pulse-chart" role="img" aria-label={`${symbol} price line during the last 24 hours`} />
      <div className="market-pulse-meta"><span>Apertura {formatPrice(data?.open)}</span><span>{data?.source ? data.source.toUpperCase() : error ?? "Cargando…"}</span></div>
    </div>
    <div className="market-sessions">
      <header><span>SESIONES · HORARIO UTC</span><b>{activeCount} ACTIVAS</b></header>
      {sessions.map((session) => <div className="market-session" key={session.id}>
        <div><strong>{session.label}</strong><span>{session.city}</span></div>
        <div className="market-session-hours" title={`Horario de rueda expresado en UTC: ${session.utcHours}`}><b>{session.utcHours}</b><small>UTC</small></div>
        <span className={`session-state ${session.open ? "open" : "closed"}`}>{session.open ? "ABIERTA" : "CERRADA"}</span>
      </div>)}
    </div>
    <div className="current-day-move">
      <span>HOY · DESDE 00:00 UTC</span>
      <strong className={currentDayTone}>{signedPercent(currentDayChangePct)}</strong>
      <b className={currentDayTone}>{signedMoney(currentDayChangeUsd)}</b>
      <small>Apertura {formatPrice(data?.currentDayOpen)}</small>
    </div>
  </section>;
}

function pulseOption(points: DailyPayload["points"], tone: "positive" | "negative"): echarts.EChartsOption {
  const color = tone === "positive" ? "#2ee6aa" : "#ff5377";
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 2, right: 2, top: 7, bottom: 5 },
    tooltip: { trigger: "axis", confine: true, backgroundColor: "#080d14", borderColor: "#26364b", textStyle: { color: "#dce6f2", fontSize: 9 }, valueFormatter: (value) => formatPrice(Number(value)) },
    xAxis: { type: "time", show: false },
    yAxis: { type: "value", show: false, scale: true },
    series: [{ type: "line", data: points.map((point) => [point.ts, point.price]), showSymbol: false, smooth: 0.16, lineStyle: { color, width: 1.7 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${color}35` }, { offset: 1, color: `${color}00` }]) }, emphasis: { disabled: true } }],
  };
}

function signedPercent(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function signedMoney(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Math.abs(value))}`; }
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 2 : 5 }).format(value)}`; }
