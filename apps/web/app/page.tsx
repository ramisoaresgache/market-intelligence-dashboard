"use client";

import { useMemo, useState } from "react";
import { EstimatedLiquidationHeatmap } from "../components/charts/estimated-liquidation-heatmap";
import { LiquidityHeatmap } from "../components/charts/liquidity-heatmap";
import { LiquidationProfileMap } from "../components/charts/liquidation-profile-map";
import { CapitalFlows } from "../components/capital-flows";
import { ObservedLiquidationSummary } from "../components/observed-liquidation-summary";
import { MarketPulse } from "../components/market-pulse";
import { FearGreedCard } from "../components/fear-greed-card";
import { InfoTooltip } from "../components/info-tooltip";
import { consolidateOrderBooks } from "../lib/market/engine/visualization";
import { useEstimatedLiquidations } from "../lib/market/use-estimated-liquidations";
import { useHistoricalLiquidationMap } from "../lib/market/use-historical-liquidation-map";
import { useLiquidityHistory } from "../lib/market/use-liquidity-history";
import { useMarketEngine } from "../lib/market/use-market-engine";
import type {
  ExchangeFilter,
  LiquidationEvent,
  MarketSnapshot,
  SourceStatus,
} from "../lib/market/types";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const price = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Dashboard() {
  const { snapshots, sources, symbols } = useMarketEngine();
  const [activeSymbol, setActiveSymbol] = useState("BTCUSDT");
  const [liquidityExchange, setLiquidityExchange] = useState<ExchangeFilter>("all");
  const [view, setView] = useState<DashboardView>("market");
  const snapshot = snapshots[activeSymbol];
  const history = useLiquidityHistory(activeSymbol, snapshot, liquidityExchange);
  const liquidationModel = useEstimatedLiquidations(activeSymbol, snapshot);
  const historicalLiquidations = useHistoricalLiquidationMap(activeSymbol);
  const liquidationZones = useMemo(() => [...historicalLiquidations.zones, ...liquidationModel.zones], [historicalLiquidations.zones, liquidationModel.zones]);
  const book = useMemo(
    () => consolidateOrderBooks(snapshot?.orderBooks ?? []),
    [snapshot?.orderBooks],
  );
  const bybit = snapshot?.metrics.find((metric) => metric.exchange === "bybit");
  const binance = snapshot?.metrics.find((metric) => metric.exchange === "binance");
  const mark = bybit?.markPrice ?? bybit?.lastPrice ?? book.mid;
  const connection = overallState(sources);
  const asset = activeSymbol.replace("USDT", "");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" type="button" onClick={() => setView("market")} aria-label="Market Intelligence home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>MI</b><small>MARKET INTEL</small></span>
        </button>
        <nav aria-label="Dashboard sections">
          <NavLink view="market" icon="waves" label="Mercado" current={view} onSelect={setView} />
          <NavLink view="liquidations" icon="bolt" label="Liquidaciones" current={view} onSelect={setView} />
          <NavLink view="flows" icon="flows" label="Flujos y reservas" current={view} onSelect={setView} />
          <NavLink view="news" icon="news" label="Noticias" current={view} onSelect={setView} />
        </nav>
        <div className="sidebar-status">
          <span className={`system-pulse ${connection}`} />
          <div><b>{connection === "live" ? "SYSTEM LIVE" : connection.toUpperCase()}</b><small>Browser engine · 150ms UI</small></div>
        </div>
        <p className="sidebar-note">Read-only market intelligence.<br />No trading. No account required.</p>
      </aside>

      <div className="workspace">
        <header className="terminal-header">
          <div className="market-ticker" aria-label="Tracked markets">
            {symbols.map((symbol) => (
              <TickerItem
                key={symbol}
                symbol={symbol}
                snapshot={snapshots[symbol]}
                active={symbol === activeSymbol}
                onSelect={() => setActiveSymbol(symbol)}
              />
            ))}
          </div>
          <div className="source-cluster">
            {sources.map((source) => <SourcePill key={source.exchange} source={source} />)}
          </div>
        </header>

        <main className="dashboard" id="overview">
          <section className="market-hero">
            <div className="market-title">
              <div className={`asset-orb ${asset.toLowerCase()}`}>{asset.slice(0, 1)}</div>
              <div>
                <span className="section-kicker">{activeSymbol} · PERPETUO</span>
                <h1>{asset}<em>/USDT</em></h1>
                <p>Datos públicos consolidados · perpetuos de Binance · Bybit · BingX · Bitunix</p>
              </div>
            </div>
            <MarketPulse symbol={activeSymbol} currentPrice={mark} />
            <div className="live-price">
              <small>PRECIO DE MARCA</small>
              <strong>{mark == null ? "—" : `$${price.format(mark)}`}</strong>
              <span className={snapshot?.ts ? "fresh" : "waiting"}>
                <i /> {snapshot?.ts ? `actualizado ${time(snapshot.ts)}` : "esperando datos de mercado"}
              </span>
            </div>
          </section>

          <section className="metric-ribbon" aria-label={`${activeSymbol} live metrics`}>
            <HeroMetric label="MEJOR COMPRA" value={formatPrice(book.bestBid)} tone="bid" foot="mayor precio comprador" help="Precio más alto que un comprador ofrece ahora entre los libros visibles. No incluye comisiones ni deslizamiento." />
            <HeroMetric label="MEJOR VENTA" value={formatPrice(book.bestAsk)} tone="ask" foot="menor precio vendedor" help="Precio más bajo al que un vendedor ofrece ahora entre los libros visibles." />
            <HeroMetric
              label={book.crossed ? "MERCADO CRUZADO" : "DIFERENCIAL"}
              value={formatSpread(book.crossVenueSpread)}
              tone={book.crossed ? "warning" : ""}
              foot={book.crossed ? "precios solapados entre exchanges" : "venta − compra"}
              help="Diferencia entre la mejor venta y la mejor compra consolidadas. Si es negativa, hay precios solapados entre exchanges; no implica arbitraje ejecutable por latencia, comisiones y profundidad."
            />
            <HeroMetric label="INTERÉS ABIERTO" value={money(bybit?.openInterestValue)} foot="nocional en Bybit" help="Valor nocional aproximado de las posiciones de derivados que siguen abiertas en Bybit. No es volumen negociado." />
            <HeroMetric label="IA BINANCE" value={number(binance?.openInterest)} foot="contratos abiertos" help="Cantidad de contratos perpetuos abiertos informada por Binance. Su unidad no es comparable directamente con el nocional en dólares de Bybit." />
            <HeroMetric label="FINANCIAMIENTO" value={funding(bybit?.fundingRate)} tone={fundingTone(bybit?.fundingRate)} foot={bybit?.nextFundingTime ? `próximo ${time(bybit.nextFundingTime)}` : "Bybit"} help="Pago periódico entre largos y cortos. Una tasa positiva suele significar que los largos pagan a los cortos; una negativa, lo contrario." />
            <FearGreedCard />
          </section>

          {view === "market" ? <section className="dashboard-grid market-maps section-view">
            <LiquidityHeatmap
              key={`orderbook-${activeSymbol}`}
              symbol={activeSymbol}
              history={history}
              candles={historicalLiquidations.candles}
              exchange={liquidityExchange}
              onExchangeChange={setLiquidityExchange}
            />
            <LiquidationProfileMap key={`profile-${activeSymbol}`} symbol={activeSymbol} currentPrice={mark} zones={liquidationZones} candles={historicalLiquidations.candles} />
            <EstimatedLiquidationHeatmap
              key={`liquidations-${activeSymbol}`}
              symbol={activeSymbol} samples={liquidationModel.samples} candles={historicalLiquidations.candles}
              zones={liquidationZones}
              observed={snapshot?.liquidations ?? []} historyState={historicalLiquidations.state}
            />
          </section> : null}

          {view === "liquidations" ? <section className="liquidations-view section-view">
            <ObservedLiquidationSummary symbol={activeSymbol} liquidations={snapshot?.liquidations ?? []} />
            <div className="lower-grid liquidation-detail-grid">
              <LiquidationsPanel symbol={activeSymbol} snapshot={snapshot} />
              <MarketQualityPanel sources={sources} snapshot={snapshot} />
            </div>
          </section> : null}

          {view === "flows" ? <div className="section-view"><CapitalFlows /></div> : null}

          {view === "news" ? <section className="news-view section-view">
            <section className="news-panel">
              <div className="panel-heading compact-heading">
                <div>
                  <span className="section-kicker">NEWS & MACRO</span>
                  <h2>Event intelligence</h2>
                </div>
                <span className="planned-badge">PLANNED</span>
              </div>
              <div className="empty-module">
                <NewsIcon />
                <strong>Official sources not connected yet</strong>
                <p>FED, SEC, GDELT and macro feeds belong to the next scoped module. No synthetic headlines are shown.</p>
              </div>
            </section>
          </section> : null}

          <footer className="app-footer">
            <span>MARKET INTELLIGENCE / PUBLIC MVP</span>
            <span>Order book data is observed · liquidation zones are explicitly modeled estimates</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function TickerItem({ symbol, snapshot, active, onSelect }: { symbol: string; snapshot?: MarketSnapshot; active: boolean; onSelect: () => void }) {
  const metrics = snapshot?.metrics.find((item) => item.exchange === "bybit");
  const value = metrics?.markPrice ?? metrics?.lastPrice;
  return (
    <button type="button" className={`ticker-item ${active ? "active" : ""}`} onClick={onSelect}>
      <span>{symbol.replace("USDT", "")}</span>
      <b>{value == null ? "—" : `$${price.format(value)}`}</b>
      <i className={snapshot?.ts ? "online" : ""} />
    </button>
  );
}

function SourcePill({ source }: { source: SourceStatus }) {
  return (
    <span className={`source-pill ${source.state}`} title={source.detail} data-testid={`source-${source.exchange}`}>
      <i /> {source.exchange} <b>{source.state}</b>
    </span>
  );
}

type DashboardView = "market" | "liquidations" | "flows" | "news";

function NavLink({ view, icon, label, current, onSelect }: { view: DashboardView; icon: string; label: string; current: DashboardView; onSelect: (view: DashboardView) => void }) {
  return <button type="button" onClick={() => onSelect(view)} className={current === view ? "active" : ""}><span className={`nav-icon ${icon}`} />{label}</button>;
}

function HeroMetric({ label, value, foot, help, tone = "" }: { label: string; value: string; foot: string; help: string; tone?: string }) {
  return <div className="hero-stat"><div className="hero-stat-label"><span>{label}</span><InfoTooltip label={label} text={help} /></div><b className={tone}>{value}</b><small>{foot}</small></div>;
}

function LiquidationsPanel({ symbol, snapshot }: { symbol: string; snapshot?: MarketSnapshot }) {
  const liquidations = snapshot?.liquidations ?? [];
  const longTotal = sumLiquidations(liquidations, "long");
  const shortTotal = sumLiquidations(liquidations, "short");
  const max = Math.max(longTotal, shortTotal, 1);
  return (
    <section className="data-panel liquidations-panel">
      <div className="panel-heading compact-heading">
        <div><span className="section-kicker">OBSERVED EVENTS</span><h2>Live liquidations</h2></div>
        <span className="event-count">{liquidations.length} / 100</span>
      </div>
      <div className="liquidation-balance">
        <div><span>LONGS</span><b className="ask">{money(longTotal)}</b><i><em style={{ width: `${(longTotal / max) * 100}%` }} /></i></div>
        <div><span>SHORTS</span><b className="bid">{money(shortTotal)}</b><i><em style={{ width: `${(shortTotal / max) * 100}%` }} /></i></div>
      </div>
      <div className="event-list">
        {liquidations.length ? [...liquidations].reverse().slice(0, 7).map((event, index) => (
          <LiquidationRow key={`${event.exchange}-${event.ts}-${index}`} event={event} />
        )) : <div className="list-empty"><span className="pulse-dot" />Listening for {symbol} liquidations…</div>}
      </div>
    </section>
  );
}

function LiquidationRow({ event }: { event: LiquidationEvent }) {
  return (
    <div className="event-row">
      <time>{time(event.ts)}</time>
      <span className={`side-tag ${event.side}`}>{event.side}</span>
      <b>{money(event.notional)}</b>
      <span>@ {formatPrice(event.price)}</span>
      <small>{event.exchange} · {event.sourceQuality}</small>
    </div>
  );
}

function MarketQualityPanel({ sources, snapshot }: { sources: SourceStatus[]; snapshot?: MarketSnapshot }) {
  return (
    <section className="data-panel quality-panel">
      <div className="panel-heading compact-heading"><div><span className="section-kicker">SOURCE HEALTH</span><h2>Data quality</h2></div></div>
      <div className="quality-list">
        {sources.map((source) => {
          const hasBook = snapshot?.orderBooks.some((book) => book.exchange === source.exchange);
          return (
            <div key={source.exchange}>
              <span className={`health-light ${source.connected ? "online" : ""}`} />
              <p><b>{source.exchange}</b><small>{source.detail ?? source.state}</small></p>
              <em>{hasBook ? "BOOK LIVE" : source.state.toUpperCase()}</em>
            </div>
          );
        })}
        <div><span className="health-light online" /><p><b>UI publisher</b><small>Worker → React snapshots</small></p><em>150 MS</em></div>
      </div>
      <p className="quality-note">Order books: Binance, Bybit, BingX and Bitunix. Observed liquidations: Binance partial snapshots and Bybit <code>allLiquidation</code>; BingX and Bitunix are not labeled as liquidation sources because their public documentation does not expose an equivalent feed.</p>
    </section>
  );
}

function NewsIcon() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 9h25a3 3 0 0 1 3 3v27H13a3 3 0 0 1-3-3V9Zm0 25H7a3 3 0 0 0 3 3m7-20h14M17 23h14M17 29h9" /></svg>;
}

function overallState(sources: SourceStatus[]): "connecting" | "live" | "reconnecting" {
  if (sources.length > 0 && sources.every((source) => source.connected)) return "live";
  if (sources.some((source) => source.state === "reconnecting")) return "reconnecting";
  return "connecting";
}

function sumLiquidations(events: LiquidationEvent[], side: "long" | "short"): number {
  return events.filter((event) => event.side === side).reduce((sum, event) => sum + event.notional, 0);
}

function formatPrice(value: number | null | undefined): string {
  return value == null ? "—" : `$${price.format(value)}`;
}

function formatSpread(value: number | null): string {
  if (value === null) return "—";
  const prefix = value < 0 ? "−" : "";
  return `${prefix}$${price.format(Math.abs(value))}`;
}

function money(value?: number | null): string {
  return value == null ? "—" : `$${compact.format(value)}`;
}

function number(value?: number | null): string {
  return value == null ? "—" : compact.format(value);
}

function funding(value?: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(4)}%`;
}

function fundingTone(value?: number | null): string {
  if (value == null || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}
