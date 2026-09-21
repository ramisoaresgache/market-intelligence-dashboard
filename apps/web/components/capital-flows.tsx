"use client";

import { useEffect, useState } from "react";

type ExchangeHistoryPoint = {
  date: string;
  reserveBtc: number | null;
  inflowBtc: number | null;
  outflowBtc: number | null;
  priceUsd: number | null;
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

const CHART_WIDTH = 1100;
const CHART_HEIGHT = 340;
const MARGIN = { top: 24, right: 94, bottom: 54, left: 88 };

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
  const exchangeHistory = exchange?.history ?? [];

  return (
    <section className="capital-flows-panel panel">
      <div className="capital-flows-heading">
        <div>
          <span className="kicker">FLUJOS DE CAPITAL · FUENTES PÚBLICAS</span>
          <h3>BTC en exchanges y ETF spot cripto</h3>
          <p className="muted-note">
            Flujos on-chain agregados de BTC hacia/desde exchanges identificados y flujos reales de ETF spot.
          </p>
        </div>
      </div>

      {error ? <div className="insight-empty">{error}</div> : null}

      <div className="capital-flow-grid">
        <article className="insight-card capital-flow-card">
          <div className="insight-card-head">
            <strong>BTC ↔ Exchanges</strong>
            <span>Coin Metrics · todos</span>
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
                <span>{item?.source ?? "SoSoValue"} · datos reales</span>
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
                Vista agregada de todos los exchanges identificados por Coin Metrics. Eje izquierdo: BTC. Eje derecho: precio BTC en USD.
              </p>
            </div>
            <span className="aggregate-badge">TODOS LOS EXCHANGES</span>
          </div>

          <div className="exchange-chart-card">
            <div className="exchange-chart-title">
              <strong>Saldo de BTC · todos los exchanges</strong>
              <span>Saldo agregado vs. precio BTC</span>
            </div>
            <BalanceChart points={exchangeHistory} />
          </div>

          <div className="exchange-chart-card">
            <div className="exchange-chart-title">
              <strong>Entradas / salidas de BTC · todos los exchanges</strong>
              <span>Barras = flujo BTC · línea amarilla = precio BTC</span>
            </div>
            <FlowChart points={exchangeHistory} />
          </div>

          <p className="exchange-method-note">
            Coin Metrics identifica wallets hot y cold de exchanges mediante heurísticas y fuentes propias. Los saldos son una estimación agregada y pueden subestimar el total real si existen direcciones todavía no identificadas.
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
  if (usable.length < 2) return <Empty text="Todavía no hay histórico suficiente para graficar." />;

  const balances = usable.map((point) => point.reserveBtc as number);
  const prices = usable.map((point) => point.priceUsd).filter((value): value is number => value != null);
  const balanceDomain = paddedDomain(Math.min(...balances), Math.max(...balances));
  const priceDomain = prices.length
    ? paddedDomain(Math.min(...prices), Math.max(...prices))
    : ([0, 1] as const);

  const balancePath = linePath(
    balances,
    balanceDomain,
    CHART_WIDTH,
    CHART_HEIGHT,
    MARGIN,
  );
  const pricePath = indexedLinePath(
    usable,
    (point) => point.priceUsd,
    priceDomain,
    CHART_WIDTH,
    CHART_HEIGHT,
    MARGIN,
  );

  const balanceTicks = numericTicks(balanceDomain, 5);
  const priceTicks = numericTicks(priceDomain, 5);
  const dateTicks = dateTickIndexes(usable.length, 6);
  const plotBottom = CHART_HEIGHT - MARGIN.bottom;
  const plotRight = CHART_WIDTH - MARGIN.right;

  return (
    <div className="exchange-svg-wrap">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Histórico de saldo BTC y precio">
        <g className="chart-grid-lines">
          {balanceTicks.map((value) => {
            const y = mapY(value, balanceDomain, CHART_HEIGHT, MARGIN);
            return <line key={value} x1={MARGIN.left} x2={plotRight} y1={y} y2={y} />;
          })}
        </g>

        <path
          className="reserve-area"
          d={`${balancePath} L ${plotRight} ${plotBottom} L ${MARGIN.left} ${plotBottom} Z`}
        />
        <path className="reserve-line" d={balancePath} />
        {pricePath ? <path className="price-line" d={pricePath} /> : null}

        <g className="chart-axis chart-axis-left">
          {balanceTicks.map((value) => {
            const y = mapY(value, balanceDomain, CHART_HEIGHT, MARGIN);
            return <text key={value} x={MARGIN.left - 10} y={y + 4} textAnchor="end">{formatAxisBtc(value)}</text>;
          })}
          <text className="axis-title" x={14} y={MARGIN.top} textAnchor="start">Saldo BTC</text>
        </g>

        <g className="chart-axis chart-axis-right">
          {priceTicks.map((value) => {
            const y = mapY(value, priceDomain, CHART_HEIGHT, MARGIN);
            return <text key={value} x={plotRight + 10} y={y + 4} textAnchor="start">{formatAxisUsd(value)}</text>;
          })}
          <text className="axis-title" x={CHART_WIDTH - 12} y={MARGIN.top} textAnchor="end">Precio BTC</text>
        </g>

        <g className="chart-axis chart-axis-x">
          {dateTicks.map((index) => {
            const x = mapX(index, usable.length, CHART_WIDTH, MARGIN);
            return (
              <g key={index}>
                <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} />
                <text x={x} y={CHART_HEIGHT - 18} textAnchor="middle">{formatAxisDate(usable[index]?.date)}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="chart-legend">
        <span className="reserve-dot" />Saldo BTC
        <span className="price-dot" />Precio BTC
      </div>
    </div>
  );
}

function FlowChart({ points }: { points: ExchangeHistoryPoint[] }) {
  const usable = points
    .filter((point) => point.inflowBtc != null || point.outflowBtc != null)
    .slice(-180);
  if (!usable.length) return <Empty text="Todavía no hay histórico de entradas/salidas para graficar." />;

  const maxFlow = Math.max(1, ...usable.flatMap((point) => [point.inflowBtc ?? 0, point.outflowBtc ?? 0]));
  const flowDomain = [-maxFlow, maxFlow] as const;
  const prices = usable.map((point) => point.priceUsd).filter((value): value is number => value != null);
  const priceDomain = prices.length
    ? paddedDomain(Math.min(...prices), Math.max(...prices))
    : ([0, 1] as const);
  const pricePath = indexedLinePath(
    usable,
    (point) => point.priceUsd,
    priceDomain,
    CHART_WIDTH,
    CHART_HEIGHT,
    MARGIN,
  );

  const plotRight = CHART_WIDTH - MARGIN.right;
  const plotBottom = CHART_HEIGHT - MARGIN.bottom;
  const zeroY = mapY(0, flowDomain, CHART_HEIGHT, MARGIN);
  const barWidth = Math.max(1.4, (plotRight - MARGIN.left) / usable.length / 2.5);
  const flowTicks = numericTicks(flowDomain, 5);
  const priceTicks = numericTicks(priceDomain, 5);
  const dateTicks = dateTickIndexes(usable.length, 6);

  return (
    <div className="exchange-svg-wrap">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Entradas y salidas diarias de BTC con precio BTC">
        <g className="chart-grid-lines">
          {flowTicks.map((value) => {
            const y = mapY(value, flowDomain, CHART_HEIGHT, MARGIN);
            return <line key={value} x1={MARGIN.left} x2={plotRight} y1={y} y2={y} />;
          })}
        </g>
        <line className="flow-zero" x1={MARGIN.left} x2={plotRight} y1={zeroY} y2={zeroY} />

        {usable.map((point, index) => {
          const x = mapX(index, usable.length, CHART_WIDTH, MARGIN);
          const inflow = point.inflowBtc ?? 0;
          const outflow = point.outflowBtc ?? 0;
          const inflowY = mapY(inflow, flowDomain, CHART_HEIGHT, MARGIN);
          const outflowY = mapY(-outflow, flowDomain, CHART_HEIGHT, MARGIN);
          return (
            <g key={`${point.date}-${index}`}>
              <rect className="flow-in" x={x - barWidth} y={inflowY} width={barWidth} height={Math.max(0, zeroY - inflowY)} />
              <rect className="flow-out" x={x} y={zeroY} width={barWidth} height={Math.max(0, outflowY - zeroY)} />
            </g>
          );
        })}

        {pricePath ? <path className="price-line flow-price-line" d={pricePath} /> : null}

        <g className="chart-axis chart-axis-left">
          {flowTicks.map((value) => {
            const y = mapY(value, flowDomain, CHART_HEIGHT, MARGIN);
            return <text key={value} x={MARGIN.left - 10} y={y + 4} textAnchor="end">{formatAxisBtcSigned(value)}</text>;
          })}
          <text className="axis-title" x={14} y={MARGIN.top} textAnchor="start">Flujo BTC/día</text>
        </g>

        <g className="chart-axis chart-axis-right">
          {priceTicks.map((value) => {
            const y = mapY(value, priceDomain, CHART_HEIGHT, MARGIN);
            return <text key={value} x={plotRight + 10} y={y + 4} textAnchor="start">{formatAxisUsd(value)}</text>;
          })}
          <text className="axis-title" x={CHART_WIDTH - 12} y={MARGIN.top} textAnchor="end">Precio BTC</text>
        </g>

        <g className="chart-axis chart-axis-x">
          {dateTicks.map((index) => {
            const x = mapX(index, usable.length, CHART_WIDTH, MARGIN);
            return (
              <g key={index}>
                <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} />
                <text x={x} y={CHART_HEIGHT - 18} textAnchor="middle">{formatAxisDate(usable[index]?.date)}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="chart-legend">
        <span className="flow-in-dot" />Entradas
        <span className="flow-out-dot" />Salidas
        <span className="price-dot" />Precio BTC
      </div>
    </div>
  );
}

function paddedDomain(min: number, max: number): readonly [number, number] {
  const rawRange = max - min;
  const pad = (rawRange || Math.abs(max) || 1) * 0.06;
  return [min - pad, max + pad] as const;
}

function numericTicks(domain: readonly [number, number], count: number): number[] {
  const [min, max] = domain;
  if (count <= 1) return [min];
  return Array.from({ length: count }, (_, index) => min + (index / (count - 1)) * (max - min));
}

function dateTickIndexes(length: number, count: number): number[] {
  if (length <= 1) return [0];
  return Array.from(
    new Set(Array.from({ length: Math.min(count, length) }, (_, index) => Math.round((index / Math.max(1, Math.min(count, length) - 1)) * (length - 1)))),
  );
}

function mapX(index: number, length: number, width: number, margin: typeof MARGIN): number {
  const plotWidth = width - margin.left - margin.right;
  return margin.left + (index / Math.max(1, length - 1)) * plotWidth;
}

function mapY(value: number, domain: readonly [number, number], height: number, margin: typeof MARGIN): number {
  const [min, max] = domain;
  const range = max - min || 1;
  const plotHeight = height - margin.top - margin.bottom;
  return margin.top + (1 - (value - min) / range) * plotHeight;
}

function linePath(
  values: number[],
  domain: readonly [number, number],
  width: number,
  height: number,
  margin: typeof MARGIN,
): string {
  return values
    .map((value, index) => {
      const x = mapX(index, values.length, width, margin);
      const y = mapY(value, domain, height, margin);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function indexedLinePath<T>(
  points: T[],
  getValue: (point: T) => number | null,
  domain: readonly [number, number],
  width: number,
  height: number,
  margin: typeof MARGIN,
): string {
  const commands: string[] = [];
  let started = false;
  points.forEach((point, index) => {
    const value = getValue(point);
    if (value == null || !Number.isFinite(value)) {
      started = false;
      return;
    }
    const x = mapX(index, points.length, width, margin);
    const y = mapY(value, domain, height, margin);
    commands.push(`${started ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    started = true;
  });
  return commands.join(" ");
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
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value)} BTC`;
}

function formatAxisBtc(value: number): string {
  return `${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 2 }).format(value)} BTC`;
}

function formatAxisBtcSigned(value: number): string {
  if (Math.abs(value) < 1e-9) return "0 BTC";
  return `${value > 0 ? "+" : "−"}${new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(value))}`;
}

function formatAxisUsd(value: number): string {
  return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

function formatAxisDate(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(timestamp);
}

function formatSourceDate(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}
