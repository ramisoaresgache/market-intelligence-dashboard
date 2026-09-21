"use client";

import { useEffect, useState } from "react";

type CoinGlassPayload = {
  configured: boolean;
  reason?: string;
  minimumPlan?: string;
  capabilities?: string[];
  orderBook?: {
    available?: boolean;
    bidsUsd?: number;
    asksUsd?: number;
    imbalancePct?: number;
    error?: string;
  };
  bitcoinEtf?: {
    available?: boolean;
    flowUsd?: number;
    priceUsd?: number;
    breakdown?: Array<{ ticker: string; flowUsd: number }>;
    reason?: string;
    error?: string;
  };
  exchangeBalance?: {
    available?: boolean;
    total?: number;
    change?: number;
    byExchange?: Array<{ exchange: string; balance: number }>;
    error?: string;
  };
};

export function CoinGlassInsights({ symbol }: { symbol: string }) {
  const [payload, setPayload] = useState<CoinGlassPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/coinglass?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        const data = (await response.json()) as CoinGlassPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (active) {
          setPayload(data);
          setError(null);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo consultar CoinGlass");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [symbol]);

  if (error) {
    return (
      <section className="coinglass-panel panel">
        <span className="kicker">COINGLASS · OPCIONAL</span>
        <h3>Insights complementarios</h3>
        <p className="muted-note">{error}</p>
      </section>
    );
  }

  if (payload && !payload.configured) {
    return (
      <section className="coinglass-panel panel">
        <div className="coinglass-heading">
          <div>
            <span className="kicker">COINGLASS · OPCIONAL</span>
            <h3>Order book, ETF BTC y reservas en exchanges</h3>
          </div>
          <span className="coinglass-lock">API KEY REQUERIDA</span>
        </div>
        <p className="muted-note">
          La integración está preparada, pero queda apagada mientras no exista una <b>COINGLASS_API_KEY</b> del lado servidor.
          No se exponen claves en el navegador.
        </p>
        <div className="coinglass-capabilities">
          {(payload.capabilities ?? []).map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="coinglass-panel panel">
      <div className="coinglass-heading">
        <div>
          <span className="kicker">COINGLASS</span>
          <h3>Flujos y posicionamiento complementario</h3>
        </div>
        <span className="history-source central">API CONECTADA</span>
      </div>
      <div className="coinglass-grid">
        <InsightCard title="Profundidad futuros" subtitle="Bybit · ±1%">
          {payload?.orderBook?.available ? (
            <>
              <MetricRow label="Bids" value={formatMoney(payload.orderBook.bidsUsd)} tone="positive" />
              <MetricRow label="Asks" value={formatMoney(payload.orderBook.asksUsd)} tone="negative" />
              <MetricRow
                label="Imbalance"
                value={formatSignedPct(payload.orderBook.imbalancePct)}
                tone={(payload.orderBook.imbalancePct ?? 0) >= 0 ? "positive" : "negative"}
              />
            </>
          ) : (
            <Empty text={payload?.orderBook?.error ?? "Sin datos"} />
          )}
        </InsightCard>

        <InsightCard title="ETF spot BTC" subtitle="Flujo diario neto">
          {payload?.bitcoinEtf?.available ? (
            <>
              <div className={`insight-big ${(payload.bitcoinEtf.flowUsd ?? 0) >= 0 ? "positive" : "negative"}`}>
                {formatSignedMoney(payload.bitcoinEtf.flowUsd)}
              </div>
              <div className="insight-tickers">
                {(payload.bitcoinEtf.breakdown ?? []).slice(0, 4).map((item) => (
                  <span key={item.ticker}>
                    {item.ticker} <b className={item.flowUsd >= 0 ? "positive" : "negative"}>{formatSignedMoney(item.flowUsd)}</b>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Empty text={payload?.bitcoinEtf?.reason ?? payload?.bitcoinEtf?.error ?? "Sólo disponible para BTC"} />
          )}
        </InsightCard>

        <InsightCard title={`Reservas ${symbol.replace("USDT", "")}`} subtitle="Balances declarados por exchange">
          {payload?.exchangeBalance?.available ? (
            <>
              <div className="insight-big">{formatCoin(payload.exchangeBalance.total, symbol)}</div>
              <MetricRow
                label="Cambio reciente"
                value={formatSignedCoin(payload.exchangeBalance.change, symbol)}
                tone={(payload.exchangeBalance.change ?? 0) <= 0 ? "positive" : "negative"}
              />
              <div className="insight-tickers">
                {(payload.exchangeBalance.byExchange ?? []).slice(0, 4).map((item) => (
                  <span key={item.exchange}>{item.exchange} <b>{formatCoin(item.balance, symbol)}</b></span>
                ))}
              </div>
            </>
          ) : (
            <Empty text={payload?.exchangeBalance?.error ?? "Sin datos"} />
          )}
          <small className="insight-note">Mide reservas en exchanges, no identifica ballenas individuales.</small>
        </InsightCard>
      </div>
    </section>
  );
}

function InsightCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <article className="insight-card">
      <div className="insight-card-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {children}
    </article>
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

function formatMoney(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

function formatSignedMoney(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}

function formatSignedPct(value?: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCoin(value: number | undefined, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value)} ${symbol.replace("USDT", "")}`;
}

function formatSignedCoin(value: number | undefined, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatCoin(Math.abs(value), symbol)}`;
}
