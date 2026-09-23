"use client";

import * as echarts from "echarts";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useEChart } from "./charts/use-echart";

type DailyPayload = {
  source: string;
  open: number;
  close: number;
  changeUsd: number;
  changePct: number;
  points: Array<{ ts: number; price: number }>;
};

type Session = {
  id: string;
  label: string;
  city: string;
  timeZone: string;
  openMinute: number;
  closeMinute: number;
  hoursLabel: string;
};

const SESSIONS: Session[] = [
  { id: "asia", label: "ASIA", city: "Tokio", timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 15 * 60, hoursLabel: "09:00–15:00" },
  { id: "europe", label: "EUROPA", city: "Londres", timeZone: "Europe/London", openMinute: 8 * 60, closeMinute: 16 * 60 + 30, hoursLabel: "08:00–16:30" },
  { id: "usa", label: "USA", city: "Nueva York", timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60, hoursLabel: "09:30–16:00" },
];

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
  const option = useMemo(() => pulseOption(data?.points ?? [], tone), [data?.points, tone]);
  const { containerRef, exportPng } = useEChart(option);
  const sessions = SESSIONS.map((session) => ({ ...session, ...(hydrated ? marketSessionState(clock, session) : { open: false, localTime: "—" }) }));
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
      <header><span>SESIONES</span><b>{activeCount} ACTIVAS</b></header>
      {sessions.map((session) => <div className="market-session" key={session.id}>
        <div><strong>{session.label}</strong><span>{session.city}</span></div>
        <div className="market-session-hours"><b>{session.localTime}</b><small>{session.hoursLabel}</small></div>
        <span className={`session-state ${session.open ? "open" : "closed"}`}>{session.open ? "ABIERTA" : "CERRADA"}</span>
      </div>)}
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

export function marketSessionState(now: number, session: Session) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: session.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const currentMinute = hour * 60 + minute;
  return { open: !["Sat", "Sun"].includes(weekday) && currentMinute >= session.openMinute && currentMinute < session.closeMinute, localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function signedPercent(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function signedMoney(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Math.abs(value))}`; }
function formatPrice(value?: number) { return value == null || !Number.isFinite(value) ? "—" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 2 : 5 }).format(value)}`; }
