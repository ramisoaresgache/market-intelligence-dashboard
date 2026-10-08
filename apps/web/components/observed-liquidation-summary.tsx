"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiquidationEvent } from "../lib/market/types";

export type LiquidationSource = "bybit" | "gate" | "bitmex" | "binance";
type SourceWindow = { longUsd: number; shortUsd: number; totalUsd: number; events: number };
type WindowValue = SourceWindow & { byExchange?: Partial<Record<LiquidationSource, SourceWindow>> };
type CollectorSource = { enabled?: boolean; connected?: boolean; connecting?: boolean; lastMessageAt?: number | null; detail?: string | null; lastError?: string | null };
type Payload = { generatedAt?: number; windows?: Record<string, WindowValue>; collector?: { exchanges?: Partial<Record<LiquidationSource, CollectorSource>> } };
const WINDOWS = [1, 4, 12, 24] as const;
const SOURCES: Array<{ key: LiquidationSource; label: string; mode: string }> = [
  { key: "bybit", label: "Bybit", mode: "Cloudflare + navegador" },
  { key: "gate", label: "Gate.io", mode: "Cloudflare" },
  { key: "bitmex", label: "BitMEX", mode: "Cloudflare · BTC" },
  { key: "binance", label: "Binance", mode: "Sólo navegador · feed parcial" },
];

export function ObservedLiquidationSummary({ symbol, liquidations, exchange, onExchangeChange }: { symbol: string; liquidations: LiquidationEvent[]; exchange: LiquidationSource; onExchangeChange: (exchange: LiquidationSource) => void }) {
  const [central, setCentral] = useState<Payload | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/liquidations?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!response.ok) { if (active) setCentral(null); return; }
        const payload = await response.json() as Payload;
        if (active) setCentral(payload);
      } catch { if (active) setCentral(null); }
    };
    void load();
    const clockTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, 60_000);
    return () => { active = false; window.clearTimeout(clockTimer); window.clearInterval(timer); };
  }, [symbol]);

  const fallback = useMemo(() => Object.fromEntries(WINDOWS.map((hours) => {
    const referenceTime = now || Math.max(0, ...liquidations.map((event) => event.ts));
    const events = liquidations.filter((event) => event.exchange === exchange && event.ts >= referenceTime - hours * 3_600_000);
    const longUsd = events.filter((event) => event.side === "long").reduce((sum, event) => sum + event.notional, 0);
    const shortUsd = events.filter((event) => event.side === "short").reduce((sum, event) => sum + event.notional, 0);
    return [String(hours), { longUsd, shortUsd, totalUsd: longUsd + shortUsd, events: events.length }];
  })), [exchange, liquidations, now]);
  const values = Object.fromEntries(WINDOWS.map((hours) => {
    const key = `${hours}h`;
    const centralValue = central?.windows?.[key] ?? central?.windows?.[String(hours)];
    const value = exchange === "binance" ? fallback[String(hours)] : centralValue?.byExchange?.[exchange] ?? fallback[String(hours)];
    return [String(hours), value];
  }));
  const source = central?.collector?.exchanges?.[exchange];
  const status = exchange === "binance" ? "SESIÓN LOCAL" : source?.connected ? "CONECTADO" : source?.connecting ? "RECONECTANDO" : source?.enabled ? "DESCONECTADO" : "SIN ESTADO";
  const sampledAt = central?.generatedAt ? new Date(central.generatedAt).toLocaleTimeString("es-AR", { hour12: false }) : null;

  return (
    <section className="data-panel observed-summary-panel">
      <div className="panel-heading compact-heading">
        <div><span className="section-kicker">LIQUIDACIONES OBSERVADAS · {symbol.replace("USDT", "")}</span><h2>Eventos por exchange</h2></div>
        <span className={`history-badge ${central && exchange !== "binance" ? "central" : "local"}`}>{status}{sampledAt && exchange !== "binance" ? ` · ${sampledAt}` : ""}</span>
      </div>
      <div className="liquidation-source-tabs" aria-label="Fuente de liquidaciones">
        {SOURCES.map((item) => {
          const feed = central?.collector?.exchanges?.[item.key];
          const feedLabel = item.key === "binance" ? "PARCIAL" : !central ? "VERIFICANDO" : feed?.connected ? "CONECTADO" : feed?.connecting ? "RECONECTANDO" : "SIN CONEXIÓN";
          return <button type="button" key={item.key} className={exchange === item.key ? "active" : ""} onClick={() => onExchangeChange(item.key)}><b>{item.label}</b><small>{item.mode}</small><em className={feed?.connected || item.key === "binance" ? "online" : ""}>{feedLabel}</em></button>;
        })}
      </div>
      <div className="observed-window-grid">
        {WINDOWS.map((hours) => {
          const value = values[String(hours)] ?? { longUsd: 0, shortUsd: 0, totalUsd: 0, events: 0 };
          return <article key={hours}>
            <header><b>{hours}h</b><strong>{money(value.totalUsd)}</strong></header>
            <div><span>Long liquidados</span><b className="ask">{money(value.longUsd)}</b></div>
            <div><span>Short liquidados</span><b className="bid">{money(value.shortUsd)}</b></div>
            <small>{value.events} eventos observados</small>
          </article>;
        })}
      </div>
      <p className="observed-note">{exchange === "binance" ? "Binance: sólo eventos parciales vistos mientras esta pestaña está abierta; Cloudflare recibe HTTP 403 desde Binance." : central ? `Datos históricos de ${SOURCES.find((item) => item.key === exchange)?.label} recolectados por Cloudflare.${source?.lastError ? ` Último error: ${source.lastError}` : ""}` : "El collector central no respondió. Sólo se muestran eventos de esta sesión si hay un feed de navegador."} BingX, Bitunix y OKX aportan órdenes o velas, pero no se cuentan como fuentes de liquidaciones observadas.</p>
    </section>
  );
}

function money(value: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value || 0);
}
