"use client";

import { useMemo, useState } from "react";
import { LiquidityHeatmap } from "../components/charts/liquidity-heatmap";
import { OrderBookLiquidity } from "../components/charts/orderbook-liquidity";
import { consolidateOrderBooks } from "../lib/market/engine/visualization";
import { useLiquidityHistory } from "../lib/market/use-liquidity-history";
import { useMarketEngine } from "../lib/market/use-market-engine";
import type {
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
  const snapshot = snapshots[activeSymbol];
  const history = useLiquidityHistory(activeSymbol, snapshot);
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
        <a className="brand" href="#overview" aria-label="Market Intelligence home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>MI</b><small>MARKET INTEL</small></span>
        </a>
        <nav aria-label="Dashboard sections">
          <NavLink href="#overview" icon="grid" label="Overview" active />
          <NavLink href="#liquidity" icon="waves" label="Liquidity" />
          <NavLink href="#liquidations" icon="bolt" label="Liquidations" />
          <NavLink href="#news" icon="news" label="News & Macro" />
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
                <span className="section-kicker">{activeSymbol} · PERPETUAL</span>
                <h1>{asset}<em>/USDT</em></h1>
                <p>Consolidated public data · Binance USD-M + Bybit Linear</p>
              </div>
            </div>
            <div className="live-price">
              <small>MARK PRICE</small>
              <strong>{mark == null ? "—" : `$${price.format(mark)}`}</strong>
              <span className={snapshot?.ts ? "fresh" : "waiting"}>
                <i /> {snapshot?.ts ? `updated ${time(snapshot.ts)}` : "awaiting market data"}
              </span>
            </div>
          </section>

          <section className="metric-ribbon" aria-label={`${activeSymbol} live metrics`}>
            <HeroMetric label="BEST BID" value={formatPrice(book.bestBid)} tone="bid" foot="cross-venue" />
            <HeroMetric label="BEST ASK" value={formatPrice(book.bestAsk)} tone="ask" foot="cross-venue" />
            <HeroMetric
              label={book.crossed ? "CROSSED MARKET" : "SPREAD"}
              value={formatSpread(book.crossVenueSpread)}
              tone={book.crossed ? "warning" : ""}
              foot={book.crossed ? "quotes overlap across venues" : "best ask − best bid"}
            />
            <HeroMetric label="OPEN INTEREST" value={money(bybit?.openInterestValue)} foot="Bybit notional" />
            <HeroMetric label="BINANCE OI" value={number(binance?.openInterest)} foot="contracts" />
            <HeroMetric label="FUNDING" value={funding(bybit?.fundingRate)} tone={fundingTone(bybit?.fundingRate)} foot={bybit?.nextFundingTime ? `next ${time(bybit.nextFundingTime)}` : "Bybit"} />
          </section>

          <section className="dashboard-grid">
            <LiquidityHeatmap
              symbol={activeSymbol}
              history={history}
              liquidations={snapshot?.liquidations ?? []}
            />
            <OrderBookLiquidity symbol={activeSymbol} snapshot={snapshot} />
          </section>

          <section className="lower-grid" id="liquidations">
            <LiquidationsPanel symbol={activeSymbol} snapshot={snapshot} />
            <MarketQualityPanel sources={sources} snapshot={snapshot} />
            <section className="news-panel" id="news">
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
          </section>

          <footer className="app-footer">
            <span>MARKET INTELLIGENCE / PUBLIC MVP</span>
            <span>Observed data only · Binance liquidation coverage is partial</span>
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

function NavLink({ href, icon, label, active = false }: { href: string; icon: string; label: string; active?: boolean }) {
  return <a href={href} className={active ? "active" : ""}><span className={`nav-icon ${icon}`} />{label}</a>;
}

function HeroMetric({ label, value, foot, tone = "" }: { label: string; value: string; foot: string; tone?: string }) {
  return <div className="hero-stat"><span>{label}</span><b className={tone}>{value}</b><small>{foot}</small></div>;
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
      <p className="quality-note">Binance liquidations are partial snapshots. Bybit <code>allLiquidation</code> is shown as all according to source coverage.</p>
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
