"use client";

import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { useEChart } from "./charts/use-echart";

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
    <section className="capital-flows-panel data-panel">
      <div className="capital-flows-heading">
        <div>
          <span className="section-kicker">FLUJOS DE CAPITAL · FUENTES PÚBLICAS</span>
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
              <span className="section-kicker">BTC EN EXCHANGES · HISTÓRICO ON-CHAIN</span>
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
  const option = useMemo<EChartsOption>(() => exchangeChartOption(usable, "balance"), [usable]);
  const { containerRef, reset, exportPng } = useEChart(option);
  if (usable.length < 2) return <Empty text="Todavía no hay histórico suficiente para graficar." />;
  return <div className="exchange-svg-wrap"><div className="echart-actions"><button type="button" onClick={reset}>Reset</button><button type="button" onClick={() => exportPng("btc-exchange-balance.png")}>Export PNG</button></div><div ref={containerRef} className="capital-echart" role="img" aria-label="Histórico interactivo de saldo BTC y precio" /></div>;
}

function FlowChart({ points }: { points: ExchangeHistoryPoint[] }) {
  const usable = points.filter((point) => point.inflowBtc != null || point.outflowBtc != null).slice(-180);
  const option = useMemo<EChartsOption>(() => exchangeChartOption(usable, "flows"), [usable]);
  const { containerRef, reset, exportPng } = useEChart(option);
  if (!usable.length) return <Empty text="Todavía no hay histórico de entradas/salidas para graficar." />;
  return <div className="exchange-svg-wrap"><div className="echart-actions"><button type="button" onClick={reset}>Reset</button><button type="button" onClick={() => exportPng("btc-exchange-flows.png")}>Export PNG</button></div><div ref={containerRef} className="capital-echart" role="img" aria-label="Entradas y salidas interactivas de BTC" /></div>;
}

function exchangeChartOption(points: ExchangeHistoryPoint[], mode: "balance" | "flows"): EChartsOption {
  const axis = { axisLabel: { color: "#8391a5" }, axisLine: { lineStyle: { color: "#26364b" } }, splitLine: { lineStyle: { color: "rgba(117,128,145,.18)" } } };
  const price = points.flatMap((point) => point.priceUsd == null ? [] : [[Date.parse(point.date), point.priceUsd]]);
  const series: NonNullable<EChartsOption["series"]> = mode === "balance" ? [
    { name: "Saldo BTC", type: "line", showSymbol: false, smooth: false, data: points.flatMap((point) => point.reserveBtc == null ? [] : [[Date.parse(point.date), point.reserveBtc]]), lineStyle: { color: "#2ee6aa", width: 2 }, areaStyle: { color: "rgba(46,230,170,.12)" }, yAxisIndex: 0 },
    { name: "Precio BTC", type: "line", showSymbol: false, data: price, lineStyle: { color: "#f2ce58", width: 1.8 }, yAxisIndex: 1 },
  ] : [
    { name: "Entradas", type: "bar", data: points.map((point) => [Date.parse(point.date), point.inflowBtc ?? 0]), itemStyle: { color: "#2ee6aa" }, yAxisIndex: 0 },
    { name: "Salidas", type: "bar", data: points.map((point) => [Date.parse(point.date), -(point.outflowBtc ?? 0)]), itemStyle: { color: "#ff5377" }, yAxisIndex: 0 },
    { name: "Precio BTC", type: "line", showSymbol: false, data: price, lineStyle: { color: "#f2ce58", width: 1.8 }, yAxisIndex: 1 },
  ];
  return { animation: false, backgroundColor: "transparent", color: ["#2ee6aa", "#ff5377", "#f2ce58"], grid: { left: 72, right: 72, top: 35, bottom: 58 }, legend: { top: 0, textStyle: { color: "#9aa7b8", fontSize: 10 } }, tooltip: { trigger: "axis", backgroundColor: "#080d14", borderColor: "#26364b", textStyle: { color: "#d7e0ec" } }, xAxis: { type: "time", ...axis }, yAxis: [{ type: "value", scale: mode === "balance", name: mode === "balance" ? "BTC balance" : "BTC/day", nameTextStyle: { color: "#8391a5" }, ...axis }, { type: "value", scale: true, position: "right", name: "BTC price", nameTextStyle: { color: "#8391a5" }, ...axis }], dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }, { type: "slider", xAxisIndex: 0, height: 18, bottom: 8, borderColor: "#26364b", backgroundColor: "#0a1320", fillerColor: "rgba(31,214,228,.13)", handleStyle: { color: "#1fd6e4" }, textStyle: { color: "#718198" } }], series };
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

function formatSourceDate(value?: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(timestamp);
}

