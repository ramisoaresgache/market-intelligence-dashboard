"use client";

import type { MarketSnapshot, SourceStatus } from "../lib/market/types";
import { useMarketEngine } from "../lib/market/use-market-engine";

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
  const connection = overallState(sources);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">DERIVATIVES / PERPETUALS</p>
          <h1>Market Intelligence</h1>
        </div>
        <div className="status-cluster">
          {sources.map((source) => (
            <span
              className={`source ${source.connected ? "up" : "down"}`}
              key={source.exchange}
              title={source.detail}
              data-testid={`source-${source.exchange}`}
            >
              <i /> {source.exchange} · {source.state}
            </span>
          ))}
          <span className={`connection ${connection}`}>{connection}</span>
        </div>
      </header>

      <section className="intro">
        <div>
          <span className="kicker">LIVE OVERVIEW</span>
          <h2>Market pressure, without the noise.</h2>
          <p>Binance USD-M and Bybit linear perpetual data, normalized in real time.</p>
        </div>
        <div className="legend">
          <span><b className="dot cyan" />Order book</span>
          <span><b className="dot amber" />Observed liquidations</span>
          <span><b className="dot violet" />Open interest & funding</span>
        </div>
      </section>

      <section className="market-grid" aria-label="Markets">
        {symbols.map((symbol) => (
          <MarketCard
            key={symbol}
            symbol={symbol}
            snapshot={snapshots[symbol]}
            sources={sources}
          />
        ))}
      </section>

      <footer>
        <span>READ-ONLY INTELLIGENCE</span>
        <span>Observed data is exchange-reported; Binance liquidation coverage is partial.</span>
      </footer>
    </main>
  );
}
function MarketCard({
  symbol,
  snapshot,
  sources,
}: {
  symbol: string;
  snapshot?: MarketSnapshot;
  sources: SourceStatus[];
}) {
  const bybit = snapshot?.metrics.find((metric) => metric.exchange === "bybit");
  const binance = snapshot?.metrics.find((metric) => metric.exchange === "binance");
  const mark = bybit?.markPrice ?? bybit?.lastPrice ?? null;
  const books = snapshot?.orderBooks ?? [];
  const bestBid = max(books.flatMap((book) => book.bids.slice(0, 1).map((level) => level.price)));
  const bestAsk = min(books.flatMap((book) => book.asks.slice(0, 1).map((level) => level.price)));
  const liquidations = snapshot?.liquidations ?? [];
  const longLiq = liquidations
    .filter((item) => item.side === "long")
    .reduce((sum, item) => sum + item.notional, 0);
  const shortLiq = liquidations
    .filter((item) => item.side === "short")
    .reduce((sum, item) => sum + item.notional, 0);
  const asset = symbol.replace("USDT", "");

  return (
    <article className="market-card">
      <div className="card-head">
        <div className={`asset-icon ${asset.toLowerCase()}`}>{asset.slice(0, 1)}</div>
        <div>
          <h3>{asset}<span>/USDT</span></h3>
          <p>Perpetual futures</p>
        </div>
        <time>{snapshot ? time(snapshot.ts) : "Awaiting feed"}</time>
      </div>

      <div className="hero-metric">
        <span>MARK PRICE</span>
        <strong>{mark === null ? "—" : `$${price.format(mark)}`}</strong>
      </div>

      <div className="book-strip">
        <div><span>BEST BID</span><b className="bid">{formatPrice(bestBid)}</b></div>
        <div><span>BEST ASK</span><b className="ask">{formatPrice(bestAsk)}</b></div>
        <div><span>SPREAD</span><b>{bestBid && bestAsk ? price.format(bestAsk - bestBid) : "—"}</b></div>
      </div>

      <div className="metric-grid">
        <Metric label="BYBIT OI" value={money(bybit?.openInterestValue)} />
        <Metric label="BINANCE OI" value={number(binance?.openInterest)} />
        <Metric label="FUNDING" value={funding(bybit?.fundingRate)} tone={fundingTone(bybit?.fundingRate)} />
        <Metric label="NEXT FUNDING" value={bybit?.nextFundingTime ? time(bybit.nextFundingTime) : "—"} />
      </div>

      <div className="liquidations">
        <div className="section-title"><span>OBSERVED LIQUIDATIONS</span><small>latest 100 events</small></div>
        <div className="liq-row">
          <span><i className="long" />Longs <b>${compact.format(longLiq)}</b></span>
          <span><i className="short" />Shorts <b>${compact.format(shortLiq)}</b></span>
        </div>
      </div>

      <div className="exchange-row">
        {["binance", "bybit"].map((exchange) => {
          const source = sources.find((item) => item.exchange === exchange);
          return <span key={exchange} className={source?.connected ? "healthy" : "unavailable"}>{exchange}</span>;
        })}
      </div>
    </article>
  );
}

function overallState(sources: SourceStatus[]): "connecting" | "live" | "reconnecting" {
  if (sources.length > 0 && sources.every((source) => source.connected)) return "live";
  if (sources.some((source) => source.state === "reconnecting")) return "reconnecting";
  return "connecting";
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="metric"><span>{label}</span><b className={tone}>{value}</b></div>;
}

function max(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function min(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : price.format(value);
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
