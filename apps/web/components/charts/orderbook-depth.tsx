"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiquidityFrame } from "../../lib/market/use-liquidity-history";
import type { ExchangeFilter, MarketSnapshot } from "../../lib/market/types";

type Row = { price: number; notional: number; exchange: string };
type Props = {
  symbol: string;
  snapshot?: MarketSnapshot;
  history: LiquidityFrame[];
  exchange: ExchangeFilter;
  onExchangeChange: (exchange: ExchangeFilter) => void;
};

const SOURCES: Array<{ value: ExchangeFilter; label: string }> = [
  { value: "all", label: "4 en vivo" },
  { value: "binance", label: "Binance" },
  { value: "bybit", label: "Bybit" },
  { value: "bingx", label: "BingX" },
  { value: "bitunix", label: "Bitunix" },
  { value: "okx", label: "OKX · 1 min" },
];

export function OrderBookDepth({ symbol, snapshot, history, exchange, onExchangeChange }: Props) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 15_000);
    const initial = window.setTimeout(update, 0);
    return () => { window.clearInterval(timer); window.clearTimeout(initial); };
  }, []);
  const model = useMemo(() => {
    if (exchange === "okx") {
      const frame = history.at(-1);
      if (!frame) return null;
      return {
        ts: frame.ts,
        mid: frame.mid,
        bids: frame.levels.filter((level) => level.bidNotional > 0).map((level) => ({ price: level.price, notional: level.bidNotional, exchange: "OKX" })),
        asks: frame.levels.filter((level) => level.askNotional > 0).map((level) => ({ price: level.price, notional: level.askNotional, exchange: "OKX" })),
      };
    }
    const books = (snapshot?.orderBooks ?? []).filter((book) => exchange === "all" || book.exchange === exchange);
    if (!books.length) return null;
    const bids = books.flatMap((book) => book.bids.map((level) => ({ price: level.price, notional: level.notional, exchange: book.exchange.toUpperCase() })));
    const asks = books.flatMap((book) => book.asks.map((level) => ({ price: level.price, notional: level.notional, exchange: book.exchange.toUpperCase() })));
    const bestBid = Math.max(...bids.map((row) => row.price));
    const bestAsk = Math.min(...asks.map((row) => row.price));
    return { ts: Math.max(...books.map((book) => book.ts)), mid: (bestBid + bestAsk) / 2, bids, asks };
  }, [exchange, history, snapshot]);
  const bids = [...(model?.bids ?? [])].sort((a, b) => b.price - a.price).slice(0, 16);
  const asks = [...(model?.asks ?? [])].sort((a, b) => a.price - b.price).slice(0, 16);
  const maxNotional = Math.max(1, ...bids.map((row) => row.notional), ...asks.map((row) => row.notional));
  const age = model && now ? now - model.ts : 0;

  return <section className="chart-card orderbook-depth-card" id="liquidity">
    <div className="panel-heading">
      <div><span className="section-kicker">PROFUNDIDAD OBSERVADA · {symbol.replace("USDT", "/USDT")}</span><h2>Libro de órdenes</h2><p>Órdenes límite públicas ordenadas por precio. Seleccioná un exchange para ver su libro sin mezclar cotizaciones.</p></div>
      <span className={`orderbook-age ${age > 120_000 ? "stale" : ""}`}>{model ? `${exchange === "okx" ? "SNAPSHOT CLOUDFLARE" : "WEB SOCKET"} · ${new Date(model.ts).toLocaleTimeString("es-AR", { hour12: false })}` : "ESPERANDO DATOS"}</span>
    </div>
    <div className="exchange-filter orderbook-source-filter" aria-label="Fuente del libro de órdenes">
      {SOURCES.map((source) => <button key={source.value} type="button" className={exchange === source.value ? "active" : ""} onClick={() => onExchangeChange(source.value)}>{source.label}</button>)}
    </div>
    {model ? <div className="orderbook-tables">
      <BookSide title="VENTAS · ASKS" rows={asks} maxNotional={maxNotional} side="ask" />
      <BookSide title="COMPRAS · BIDS" rows={bids} maxNotional={maxNotional} side="bid" />
    </div> : <p className="orderbook-empty">Todavía no hay un libro disponible para {SOURCES.find((source) => source.value === exchange)?.label}.</p>}
    {model ? <div className="orderbook-midline">Precio medio del libro <b>{formatPrice(model.mid)}</b></div> : null}
    <p className="orderbook-footnote">{exchange === "okx" ? "OKX proviene del collector de Cloudflare: capturas cada 1 minuto, agrupadas por precio y con caché de hasta 5 minutos. No es profundidad en tiempo real." : exchange === "all" ? "Consolidado de cuatro libros independientes: puede haber precios cruzados entre exchanges. OKX se consulta por separado desde Cloudflare." : "Las órdenes pueden modificarse o cancelarse antes de ejecutarse."}</p>
  </section>;
}

function BookSide({ title, rows, maxNotional, side }: { title: string; rows: Row[]; maxNotional: number; side: "bid" | "ask" }) {
  return <div className={`orderbook-side ${side}`}><h3>{title}</h3><div className="orderbook-column-head"><span>PRECIO</span><span>NOCIONAL USD</span><span>FUENTE</span></div>
    {rows.map((row, index) => <div className="orderbook-data-row" key={`${row.exchange}-${row.price}-${index}`}>
      <i style={{ width: `${Math.min(100, (row.notional / maxNotional) * 100)}%` }} />
      <b>{formatPrice(row.price)}</b><span>{formatMoney(row.notional)}</span><small>{row.exchange}</small>
    </div>)}
    {!rows.length ? <p className="orderbook-empty">Sin niveles visibles.</p> : null}
  </div>;
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: value >= 100 ? 2 : 4, maximumFractionDigits: value >= 100 ? 2 : 4 });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
}
