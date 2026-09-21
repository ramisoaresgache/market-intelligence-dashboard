"use client";

import { useEffect, useMemo, useState } from "react";

type ExchangeHistoryPoint = {
  date: string;
  reserveBtc: number | null;
  inflowBtc: number | null;
  outflowBtc: number | null;
  priceUsd: number | null;
};

type ExchangeBreakdown = {
  id: string;
  name: string;
  balanceBtc: number;
  change1dBtc: number | null;
  change7dBtc: number | null;
  change30dBtc: number | null;
  inflowBtc: number | null;
  outflowBtc: number | null;
  history: ExchangeHistoryPoint[];
};

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
  history?: ExchangeHistoryPoint[];
  exchanges?: ExchangeBreakdown[];
  exchangeDetailAvailable?: boolean;
  exchangeDetailError?: string | null;
};

type EtfFlow = {
  asset: string;
  source: string;
  available: boolean;
  requiresConfig?: boolean;
  date?: string;
  dailyFlowUsd?: number;
  fiveDayFlowUsd?: number;
  sevenDayFlowUsd?: number;
  netAssetsUsd?: number | null;
  cumulativeFlowUsd?: number | null;
  valueTradedUsd?: number | null;
  error?: string;
};

type CapitalFlowsPayload = {
  generatedAt: number;
  bitcoinExchange: BitcoinExchangeFlow | null;
  etfs: EtfFlow[];
  etfProviderConfigured?: boolean;
  warnings?: string[];
};

export function CapitalFlows() {
  const [payload, setPayload] = useState<CapitalFlowsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedExchange, setSelectedExchange] = useState("all");

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
  const exchangeRows = exchange?.exchanges ?? [];

  const selectedHistory = useMemo(() => {
    if (!exchange) return [];
    if (selectedExchange === "all") return exchange.history ?? [];
    return exchangeRows.find((item) => item.id === selectedExchange)?.history ?? [];
  }, [exchange, exchangeRows, selectedExchange]);

  const selectedName =
    selectedExchange === "all"
      ? "Todos los exchanges"
      : exchangeRows.find((item) => item.id === selectedExchange)?.name ?? selectedExchange;

  return (
    <section className="capital-flows-panel panel">
      <div className="capital-flows-heading">
        <div>
          <span className="kicker">FLUJOS DE CAPITAL · FUENTES PÚBLICAS</span>
          <h3>BTC en exchanges y ETF spot cripto</h3>
          <p className="muted-note">
            Flujos on-chain de BTC hacia/desde wallets identificadas de exchanges y datos de ETF spot.
          </p>
        </div>
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
              <MetricRow label="BTC enviados a exchanges" value={formatMoney(exchange.inflowUsd)} tone="negative" />
              <MetricRow label="BTC retirados de exchanges" value={formatMoney(exchange.outflowUsd)} tone="positive" />
              <MetricRow
                label="Flujo neto"
                value={formatSignedCoin(exchange.netflowBtc, "BTC")}
                tone={(exchange.netflowBtc ?? 0) <= 0 ? "positive" : "negative"}
              />
              <MetricRow
                label="Flujo neto 7d"
                value={formatSignedMoney(exchange.sevenDayNetflowUsd)}
                tone={(exchange.sevenDayNetflowUsd ?? 0) <= 0 ? "positive" : "negative"}
              />
              {exchange.reserveBtc != null ? (
                <MetricRow label="BTC identificados en exchanges" value={formatBtcBalance(exchange.reserveBtc)} />
              ) : null}
              <small className="insight-note">
                Entradas/salidas son BTC movidos on-chain, no depósitos o retiros bancarios. El valor USD es la valuación del BTC movido. Último cierre: {formatSourceDate(exchange.date)}.
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
                <span>{item?.source ?? "SoSoValue"} · USD</span>
              </div>
              {item?.available ? (
                <>
                  <div className={`insight-big ${tone}`}>{formatSignedMoney(item.dailyFlowUsd)}</div>
                  <MetricRow label="Último día" value={formatSignedMoney(item.dailyFlowUsd)} tone={tone} />
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
                  {item.netAssetsUsd != null ? <MetricRow label="Activos netos" value={formatMoney(item.netAssetsUsd)} /> : null}
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

      {exchange?.available ? (
        <div className="exchange-analytics">
          <div className="exchange-analytics-head">
            <div>
              <span className="kicker">BTC EN EXCHANGES · HISTÓRICO ON-CHAIN</span>
              <h3>Saldo y movimientos de Bitcoin</h3>
              <p className="muted-note">
                Similar a la vista de reservas de exchanges: saldo identificado, variaciones y entradas/salidas diarias.
              </p>
            </div>
            <label className="exchange-filter">
              <span>Exchange</span>
              <select value={selectedExchange} onChange={(event) => setSelectedExchange(event.target.value)}>
                <option value="all">Todos</option>
                {exchangeRows.map((item) => (
                  <option value={item.id} key={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="exchange-chart-card">
            <div className="exchange-chart-title">
              <strong>Saldo de BTC · {selectedName}</strong>
              <span>BTC retenidos vs. precio BTC</span>
            </div>
            <BalanceChart points={selectedHistory} />
          </div>

          {exchangeRows.length ? (
            <div className="exchange-table-wrap">
              <div className="exchange-table-head">
                <strong>Saldo de Bitcoin por exchange</strong>
                <span>Cambios de saldo on-chain</span>
              </div>
              <div className="exchange-balance-table">
                <div className="exchange-balance-row exchange-balance-header">
                  <span>#</span>
                  <span>Exchange</span>
                  <span>Saldo BTC</span>
                  <span>24h</span>
                  <span>7d</span>
                  <span>30d</span>
                </div>
                {exchangeRows.map((item, index) => (
                  <div className="exchange-balance-row" key={item.id}>
                    <span>{index + 1}</span>
                    <strong>{item.name}</strong>
                    <b>{formatBtcNumber(item.balanceBtc)}</b>
                    <Delta value={item.change1dBtc} />
                    <Delta value={item.change7dBtc} />
                    <Delta value={item.change30dBtc} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="exchange-detail-note">
              El histórico agregado está disponible, pero Coin Metrics Community no devolvió el desglose por exchange en esta consulta.
            </div>
          )}

          <div className="exchange-chart-card">
            <div className="exchange-chart-title">
              <strong>Entradas / salidas de BTC · {selectedName}</strong>
              <span>Verde = entra al exchange · rojo = sale del exchange</span>
            </div>
            <FlowChart points={selectedHistory} />
          </div>

          <p className="exchange-method-note">
            Coin Metrics identifica wallets hot y cold de exchanges mediante heurísticas y fuentes propias. Los saldos son una estimación y pueden subestimar el total real si existen direcciones todavía no identificadas.
          </p>
        </div>
      ) : null}

      {payload?.warnings?.length ? (
        <p className="muted-note capital-flow-warning">{payload.warnings.join(" · ")}</p>
      ) : null}
    </section>
  );
}

function BalanceChart({ points }: { points: ExchangeHistoryPoint[] }) {
  const usable = points.filter((point) => point.reserveBtc != null);
  if (usable.length < 2) return <Empty text="Todavía no hay histórico suficiente para graficar este exchange." />;

  const width = 1000;
  const height = 280;
  const pad = 24;
  const balances = usable.map((point) => point.reserveBtc as number);
  const prices = usable.map((point) => point.priceUsd).filter((value): value is number => value != null);
  const balanceMin = Math.min(...balances);
  const balanceMax = Math.max(...balances);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 1;
  const balancePath = linePath(usable.map((point) => point.reserveBtc as number), width, height, pad, balanceMin, balanceMax);
  const pricePath = prices.length === usable.length
    ? linePath(usable.map((point) => point.priceUsd as number), width, height, pad, priceMin, priceMax)
    : "";

  return (
    <div className="exchange-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Histórico de saldo BTC y precio">
        <defs>
          <linearGradient id="reserveFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <g className="chart-grid-lines">
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={height * ratio} y2={height * ratio} />)}
        </g>
        <path className="reserve-area" d={`${balancePath} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`} />
        <path className="reserve-line" d={balancePath} />
        {pricePath ? <path className="price-line" d={pricePath} /> : null}
      </svg>
      <div className="chart-legend"><span className="reserve-dot" />Saldo BTC <span className="price-dot" />Precio BTC</div>
    </div>
  );
}

function FlowChart({ points }: { points: ExchangeHistoryPoint[] }) {
  const usable = points.filter((point) => point.inflowBtc != null || point.outflowBtc != null).slice(-140);
  if (!usable.length) return <Empty text="Todavía no hay histórico de entradas/salidas para este exchange." />;

  const width = 1000;
  const height = 280;
  const pad = 24;
  const maxFlow = Math.max(1, ...usable.flatMap((point) => [point.inflowBtc ?? 0, point.outflowBtc ?? 0]));
  const barWidth = Math.max(1.4, (width - pad * 2) / usable.length / 2.6);
  const center = height / 2;

  return (
    <div className="exchange-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Entradas y salidas diarias de BTC">
        <line className="flow-zero" x1={pad} x2={width - pad} y1={center} y2={center} />
        {usable.map((point, index) => {
          const x = pad + (index / Math.max(1, usable.length - 1)) * (width - pad * 2);
          const inHeight = ((point.inflowBtc ?? 0) / maxFlow) * (center - pad);
          const outHeight = ((point.outflowBtc ?? 0) / maxFlow) * (center - pad);
          return (
            <g key={`${point.date}-${index}`}>
              <rect className="flow-in" x={x - barWidth} y={center - inHeight} width={barWidth} height={inHeight} />
              <rect className="flow-out" x={x} y={center} width={barWidth} height={outHeight} />
            </g>
          );
        })}
      </svg>
      <div className="chart-legend"><span className="flow-in-dot" />Entradas <span className="flow-out-dot" />Salidas</div>
    </div>
  );
}

function linePath(values: number[], width: number, height: number, pad: number, min: number, max: number) {
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span>—</span>;
  return <span className={value >= 0 ? "positive" : "negative"}>{formatSignedBtc(value)}</span>;
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
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value)} ${symbol}`;
}

function formatSignedCoin(value?: number | null, symbol = "BTC"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatCoin(Math.abs(value), symbol)}`;
}

function formatBtcBalance(value: number): string {
  return `${formatBtcNumber(value)} BTC`;
}

function formatBtcNumber(value: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
}

function formatSignedBtc(value: number): string {
  return `${value >= 0 ? "+" : "−"}${formatBtcNumber(Math.abs(value))}`;
}

function formatSourceDate(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}
