"use client";

import { useEffect, useMemo, useState } from "react";

type DailyPayload = {
  symbol: string;
  source: string;
  open: number;
  close: number;
  changeUsd: number;
  changePct: number;
  points: Array<{ ts: number; price: number }>;
  warnings?: string[];
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
  {
    id: "asia",
    label: "ASIA",
    city: "Tokio",
    timeZone: "Asia/Tokyo",
    openMinute: 9 * 60,
    closeMinute: 15 * 60,
    hoursLabel: "09:00–15:00",
  },
  {
    id: "europe",
    label: "EUROPA",
    city: "Londres",
    timeZone: "Europe/London",
    openMinute: 8 * 60,
    closeMinute: 16 * 60 + 30,
    hoursLabel: "08:00–16:30",
  },
  {
    id: "usa",
    label: "USA",
    city: "Nueva York",
    timeZone: "America/New_York",
    openMinute: 9 * 60 + 30,
    closeMinute: 16 * 60,
    hoursLabel: "09:30–16:00",
  },
];

export function MarketPulse({ symbol, currentPrice }: { symbol: string; currentPrice?: number }) {
  const [payload, setPayload] = useState<DailyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setError(null);
    void fetch(`/api/market-daily?symbol=${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as DailyPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) setPayload(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "No se pudo cargar el histórico diario");
        }
      });
    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const path = useMemo(() => sparklinePath(payload?.points ?? []), [payload]);
  const latest = currentPrice ?? payload?.close;
  const open = payload?.open;
  const liveChangeUsd = latest != null && open != null ? latest - open : payload?.changeUsd;
  const liveChangePct = latest != null && open != null && open > 0 ? ((latest - open) / open) * 100 : payload?.changePct;
  const tone = (liveChangeUsd ?? 0) >= 0 ? "positive" : "negative";

  return (
    <div className="market-pulse">
      <div className="market-pulse-main">
        <div className="market-pulse-heading">
          <div>
            <span className="kicker">MOVIMIENTO 24 H</span>
            <strong className={tone}>{formatSignedPct(liveChangePct)}</strong>
          </div>
          <div className="market-pulse-usdt">
            <span>Cambio</span>
            <b className={tone}>{formatSignedMoney(liveChangeUsd)}</b>
          </div>
        </div>
        <div className="market-pulse-chart" aria-label="Evolución del precio durante las últimas 24 horas">
          {payload?.points.length ? (
            <svg viewBox="0 0 320 86" preserveAspectRatio="none" role="img">
              <path className={`pulse-area ${tone}`} d={`${path} L 320 86 L 0 86 Z`} />
              <path className={`pulse-line ${tone}`} d={path} />
            </svg>
          ) : (
            <div className="pulse-loading">{error ?? "Cargando 24 h…"}</div>
          )}
        </div>
        <div className="market-pulse-meta">
          <span>Apertura 24 h {formatPrice(open)}</span>
          <span>{payload?.source ? `Fuente ${payload.source.toUpperCase()}` : "—"}</span>
        </div>
      </div>

      <div className="market-sessions">
        <span className="kicker">SESIONES</span>
        {SESSIONS.map((session) => {
          const state = marketSessionState(clock, session);
          return (
            <div className="market-session" key={session.id}>
              <div>
                <strong>{session.label}</strong>
                <span>{session.city}</span>
              </div>
              <div className="market-session-hours">
                <b>{session.hoursLabel}</b>
                <small>{state.localTime}</small>
              </div>
              <span className={`session-state ${state.open ? "open" : "closed"}`}>
                {state.open ? "ABIERTO" : "CERRADO"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sparklinePath(points: Array<{ ts: number; price: number }>): string {
  if (points.length < 2) return "";
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = Math.max(max - min, max * 0.001, 1);
  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 320;
      const y = 8 + (1 - (point.price - min) / spread) * 68;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function marketSessionState(now: number, session: Session) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const currentMinute = hour * 60 + minute;
  const businessDay = !["Sat", "Sun"].includes(weekday);
  return {
    open: businessDay && currentMinute >= session.openMinute && currentMinute < session.closeMinute,
    localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function formatSignedPct(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedMoney(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${formatCompact(Math.abs(value))} USDT`;
}

function formatPrice(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: value >= 100 ? 2 : 5 }).format(value)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
