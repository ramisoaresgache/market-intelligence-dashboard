"use client";

import { useEffect, useState } from "react";

type BitcoinExchangeFlow = {
  available: boolean;
  source: string;
  date?: string;
  inflowUsd?: number;
  outflowUsd?: number;
  netflowUsd?: number;
  inflowBtc?: number;
  outflowBtc?: number;
  netflowBtc?: number;
  reserveBtc?: number | null;
  sevenDayNetflowUsd?: number;
  sevenDayNetflowBtc?: number;
};

type EtfFlow = {
  asset: string;
  source: string;
  available: boolean;
  date?: string;
  dailyFlowUsd?: number;
  fiveDayFlowUsd?: number;
  sevenDayFlowUsd?: number;
  error?: string;
};

type CapitalFlowsPayload = {
  generatedAt: number;
  bitcoinExchange: BitcoinExchangeFlow | null;
  etfs: EtfFlow[];
  warnings?: string[];
};

export function CapitalFlows() {
  const [payload, setPayload] = useState<CapitalFlowsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/capital-flows", { cache: "no-store" });
        const data = (await response.json()) as CapitalFlowsPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (active) {
          setPayload(data);
          setError(null);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudieron cargar los flujos");
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 15 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const exchange = payload?.bitcoinExchange;
  const etfs = payload?.etfs ?? [];

  return (
    <section className="capital-flows-panel panel">
      <div className="capital-flows-heading">
        <div>
          <span className="kicker">FLUJOS DE CAPITAL · FUENTES PÚBLICAS</span>
          <h3>BTC en exchanges y ETF spot cripto</h3>
          <p className="muted-note">
            Datos descriptivos de movimiento de capital. No dependen de CoinGlass ni requieren una API paga.
          </p>
        </div>
        <span className="history-source central">SIN COINGLASS</span>
      </div>

      {error ? <div className="insight-empty">{error}</div> : null}

      <div className="capital-flow-grid">
        <article className="insight-card capital-flow-card">
          <div className="insight-card-head">
            <strong>BTC ↔ Exchanges</strong>
            <span>Coin Metrics · diario</span>
          </div>
          {exchange?.available ? (
            <>
              <div className={`insight-big ${(exchange.netflowUsd ?? 0) <= 0 ? "positive" : "negative"}`}>
                {formatSignedMoney(exchange.netflowUsd)} neto
              </div>
              <MetricRow label="Entradas" value={formatMoney(exchange.inflowUsd)} tone="negative" />
              <MetricRow label="Salidas" value={formatMoney(exchange.outflowUsd)} tone="positive" />
              <MetricRow
                label="Neto BTC"
                value={formatSignedCoin(exchange.netflowBtc, "BTC")}
                tone={(exchange.netflowBtc ?? 0) <= 0 ? "positive" : "negative"}
              />
              <MetricRow
                label="Neto 7d"
                value={formatSignedMoney(exchange.sevenDayNetflowUsd)}
                tone={(exchange.sevenDayNetflowUsd ?? 0) <= 0 ? "positive" : "negative"}
              />
              {exchange.reserveBtc != null ? (
                <MetricRow label="BTC en exchanges" value={formatCoin(exchange.reserveBtc, "BTC")} />
              ) : null}
              <small className="insight-note">
                Positivo = más BTC entra a exchanges. Negativo = salida neta hacia custodia externa. Último cierre: {formatSourceDate(exchange.date)}.
              </small>
            </>
          ) : (
            <Empty text="Coin Metrics no devolvió datos de flows de BTC." />
          )}
        </article>

        {(["BTC", "ETH", "SOL"] as const).map((asset) => {
          const item = etfs.find((entry) => entry.asset === asset);
          const tone = (item?.dailyFlowUsd ?? 0) >= 0 ? "positive" : "negative";
          return (
            <article className="insight-card capital-flow-card" key={asset}>
              <div className="insight-card-head">
                <strong>ETF spot {asset}</strong>
                <span>Farside · US$m</span>
              </div>
              {item?.available ? (
                <>
                  <div className={`insight-big ${tone}`}>{formatSignedMoney(item.dailyFlowUsd)}</div>
                  <MetricRow
                    label="Último día"
                    value={formatSignedMoney(item.dailyFlowUsd)}
                    tone={tone}
                  />
                  <MetricRow
                    label="Últimos 5 días"
                    value={formatSignedMoney(item.fiveDayFlowUsd)}
                    tone={(item.fiveDayFlowUsd ?? 0) >= 0 ? "positive" : "negative"}
                  />
                  <MetricRow
                    label="Últimos 7 días"
                    value={formatSignedMoney(item.sevenDayFlowUsd)}
                    tone={(item.sevenDayFlowUsd ?? 0) >= 0 ? "positive" : "negative"}
                  />
                  <small className="insight-note">
                    Último dato publicado: {item.date ?? "—"}. Los ETF sólo actualizan en jornadas de mercado.
                  </small>
                </>
              ) : (
                <Empty text={item?.error ?? `Sin datos ETF para ${asset}`} />
              )}
            </article>
          );
        })}
      </div>

      {payload?.warnings?.length ? (
        <p className="muted-note capital-flow-warning">{payload.warnings.join(" · ")}</p>
      ) : null}
    </section>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="insight-row">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="insight-empty">{text}</div>;
}

function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function formatSignedMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}

function formatCoin(value?: number | null, symbol = "BTC"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 3 }).format(value)} ${symbol}`;
}

function formatSignedCoin(value?: number | null, symbol = "BTC"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatCoin(Math.abs(value), symbol)}`;
}

function formatSourceDate(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}
