"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiquidationEvent } from "../lib/market/types";

type WindowValue = { longUsd: number; shortUsd: number; totalUsd: number; events: number; byExchange?: Record<string, number> };
type Payload = { coverageStart?: number | string; windows?: Record<string, WindowValue>; collector?: string };
const WINDOWS = [1, 4, 12, 24] as const;

export function ObservedLiquidationSummary({ symbol, liquidations }: { symbol: string; liquidations: LiquidationEvent[] }) {
  const [central, setCentral] = useState<Payload | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/liquidations?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as Payload;
        if (active) setCentral(payload);
      } catch { if (active) setCentral(null); }
    };
    void load();
    const clockTimer = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, 30_000);
    return () => { active = false; window.clearTimeout(clockTimer); window.clearInterval(timer); };
  }, [symbol]);

  const fallback = useMemo(() => Object.fromEntries(WINDOWS.map((hours) => {
    const referenceTime = now || Math.max(0, ...liquidations.map((event) => event.ts));
    const events = liquidations.filter((event) => event.ts >= referenceTime - hours * 3_600_000);
    const longUsd = events.filter((event) => event.side === "long").reduce((sum, event) => sum + event.notional, 0);
    const shortUsd = events.filter((event) => event.side === "short").reduce((sum, event) => sum + event.notional, 0);
    return [String(hours), { longUsd, shortUsd, totalUsd: longUsd + shortUsd, events: events.length }];
  })), [liquidations, now]);
  const values = central?.windows ?? fallback;

  return (
    <section className="data-panel observed-summary-panel">
      <div className="panel-heading compact-heading">
        <div><span className="section-kicker">LIQUIDACIONES OBSERVADAS · {symbol.replace("USDT", "")}</span><h2>Totales móviles por ventana</h2></div>
        <span className={`history-badge ${central ? "central" : "local"}`}>{central ? "HISTÓRICO CENTRAL" : "SESIÓN LOCAL"}</span>
      </div>
      <div className="observed-window-grid">
        {WINDOWS.map((hours) => {
          const value = values[String(hours)] ?? values[`${hours}h`] ?? { longUsd: 0, shortUsd: 0, totalUsd: 0, events: 0 };
          return <article key={hours}>
            <header><b>{hours}h</b><strong>{money(value.totalUsd)}</strong></header>
            <div><span>Long liquidados</span><b className="ask">{money(value.longUsd)}</b></div>
            <div><span>Short liquidados</span><b className="bid">{money(value.shortUsd)}</b></div>
            <small>{value.events} eventos observados</small>
          </article>;
        })}
      </div>
      <p className="observed-note">{central ? "Histórico recolectado 24/7 por el collector central de Cloudflare." : "El collector central no respondió; se muestran solamente eventos de esta sesión."}</p>
    </section>
  );
}

function money(value: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value || 0);
}
