"use client";

import { useEffect, useMemo, useState } from "react";
import { summarizeLiquidationWindows } from "../lib/market/liquidation-history";
import type { LiquidationEvent } from "../lib/market/types";
import { useLiquidationHistory } from "../lib/market/use-liquidation-history";

type CentralWindow = {
  longUsd: number;
  shortUsd: number;
  totalUsd: number;
  events: number;
  byExchange?: Record<string, { longUsd: number; shortUsd: number; totalUsd: number; events: number }>;
};

type CentralPayload = {
  generatedAt: number;
  symbol: string;
  coverageStart: number | null;
  windows: Record<string, CentralWindow>;
  collector?: {
    activeExchanges?: string[];
    exchanges?: Record<string, { enabled?: boolean; connected?: boolean; lastLiquidationAt?: number | null }>;
  };
};

const HOURS = [1, 4, 12, 24] as const;

export function LiquidationSummary({
  symbol,
  liquidations,
}: {
  symbol: string;
  liquidations: LiquidationEvent[];
}) {
  const localHistory = useLiquidationHistory(symbol, liquidations);
  const [clock, setClock] = useState(() => Date.now());
  const [central, setCentral] = useState<CentralPayload | null>(null);
  const [centralError, setCentralError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const load = async () => {
      try {
        const response = await fetch(`/api/liquidations?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const payload = (await response.json()) as CentralPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (active) {
          setCentral(payload);
          setCentralError(null);
        }
      } catch (error) {
        if (active) {
          setCentral(null);
          setCentralError(error instanceof Error ? error.message : "No se pudo consultar el histórico central");
        }
      }
    };

    void load();
    timer = window.setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [symbol]);

  const localWindows = useMemo(
    () => summarizeLiquidationWindows(localHistory, clock),
    [clock, localHistory],
  );

  const rows = HOURS.map((hours) => {
    const centralWindow = central?.windows?.[`${hours}h`];
    if (centralWindow) {
      return {
        hours,
        total: centralWindow.totalUsd,
        long: centralWindow.longUsd,
        short: centralWindow.shortUsd,
        events: centralWindow.events,
        byExchange: centralWindow.byExchange ?? {},
      };
    }
    const local = localWindows.find((window) => window.hours === hours);
    return {
      hours,
      total: local?.total ?? 0,
      long: local?.long ?? 0,
      short: local?.short ?? 0,
      events: local?.events ?? 0,
      byExchange: {},
    };
  });

  const sourceNames = central?.collector?.activeExchanges?.map(exchangeLabel) ?? [];
  const coverageStart = central?.coverageStart ?? localHistory[0]?.ts ?? null;

  return (
    <article className="panel liquidation-summary">
      <div className="liquidation-summary-heading">
        <div>
          <span className="kicker">LIQUIDACIONES OBSERVADAS · {symbol.replace("USDT", "")}</span>
          <h3>Totales móviles por ventana</h3>
        </div>
        <span className={`history-source ${central ? "central" : "local"}`}>
          {central ? "HISTÓRICO CENTRAL" : "FALLBACK LOCAL"}
        </span>
      </div>

      <div className="liquidation-window-grid">
        {rows.map((window) => (
          <div className="liquidation-window-card" key={window.hours}>
            <div className="liquidation-window-head">
              <span>{window.hours} h</span>
              <strong>{formatMoney(window.total)}</strong>
            </div>
            <div className="liquidation-window-row">
              <span>Long liquidados</span>
              <b className="negative">{formatMoney(window.long)}</b>
            </div>
            <div className="liquidation-window-row">
              <span>Short liquidados</span>
              <b className="positive">{formatMoney(window.short)}</b>
            </div>
            <small>{window.events} eventos observados</small>
            {Object.keys(window.byExchange).length > 0 ? (
              <div className="liquidation-sources">
                {Object.entries(window.byExchange)
                  .filter(([, value]) => value.events > 0)
                  .map(([exchange, value]) => (
                    <span key={exchange} title={`${value.events} eventos`}>
                      {exchangeLabel(exchange)} {formatMoney(value.totalUsd)}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="muted-note">
        {central
          ? `Histórico central recolectado 24/7${sourceNames.length ? ` desde ${sourceNames.join(" + ")}` : ""}.`
          : `No se pudo usar el collector central${centralError ? ` (${centralError})` : ""}; se muestran eventos observados por este navegador.`}
        {coverageStart ? ` Cobertura disponible desde ${formatDateTime(coverageStart)}.` : " La cobertura todavía se está construyendo."}
      </p>
    </article>
  );
}

function exchangeLabel(value: string): string {
  const labels: Record<string, string> = {
    bybit: "Bybit",
    gate: "Gate.io",
    bitmex: "BitMEX",
    binance: "Binance",
  };
  return labels[value] ?? value;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
