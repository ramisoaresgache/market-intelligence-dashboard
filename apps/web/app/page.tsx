"use client";

import { useEffect, useMemo, useState } from "react";
import { LiquidationHeatmap } from "../components/liquidation-heatmap";
import {
  aggregateOrderBooks,
  midpointFromBooks,
  type ExchangeFilter,
} from "../lib/market/engine/aggregate";
import { summarizeLiquidationWindows } from "../lib/market/liquidation-history";
import type { LiquidationMapSource } from "../lib/market/liquidation-model";
import { DEFAULT_SYMBOL } from "../lib/market/symbols";
import {
  LIVE_EXCHANGES,
  type AggregatedOrderLevel,
  type Exchange,
  type MarketInstrument,
  type NormalizedOrderBook,
  type SourceStatus,
} from "../lib/market/types";
import { loadMarketUniverse } from "../lib/market/universe";
import { useLiquidationHistory } from "../lib/market/use-liquidation-history";
import { setMarketSymbol, useMarketEngine } from "../lib/market/use-market-engine";

const compact = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const LIQUIDATION_HOURS = [4, 12, 24] as const;
const LIQUIDATION_SOURCES: Array<{ value: LiquidationMapSource; label: string }> = [
  { value: "aggregate", label: "Binance + Bybit + OKX" },
  { value: "binance", label: "Binance" },
  { value: "bybit", label: "Bybit" },
  { value: "okx", label: "OKX" },
];
const ORDERBOOK_SOURCES: ExchangeFilter[] = ["all", ...LIVE_EXCHANGES];
const EXCHANGE_LABELS: Record<Exchange, string> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  mexc: "MEXC",
  whitebit: "WhiteBIT",
  bingx: "BingX",
  bitunix: "Bitunix",
};
const QUICK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

export default function Dashboard() {
  const { snapshots, sources } = useMarketEngine();
  const [universe, setUniverse] = useState<MarketInstrument[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>("all");
  const [liquidationHours, setLiquidationHours] = useState<(typeof LIQUIDATION_HOURS)[number]>(24);
  const [liquidationSource, setLiquidationSource] = useState<LiquidationMapSource>("aggregate");
  const [liquidationClock, setLiquidationClock] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void loadMarketUniverse().then((markets) => {
      if (active) setUniverse(markets);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setMarketSymbol(selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    const timer = window.setInterval(() => setLiquidationClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = snapshots[selectedSymbol];
  const books = snapshot?.orderBooks ?? [];
  const bybit = snapshot?.metrics.find((metric) => metric.exchange === "bybit");
  const binance = snapshot?.metrics.find((metric) => metric.exchange === "binance");
  const okx = snapshot?.metrics.find((metric) => metric.exchange === "okx");
  const currentPrice =
    bybit?.markPrice ??
    binance?.markPrice ??
    okx?.markPrice ??
    bybit?.lastPrice ??
    midpointFromBooks(books);
  const aggregated = useMemo(
    () => aggregateOrderBooks(books, exchangeFilter, undefined, 24),
    [books, exchangeFilter],
  );
  const referenceTop = useMemo(() => bestConsistentTop(books), [books]);
  const liquidations = snapshot?.liquidations ?? [];
  const liquidationHistory = useLiquidationHistory(selectedSymbol, liquidations);
  const liquidationWindows = useMemo(
    () => summarizeLiquidationWindows(liquidationHistory, liquidationClock),
    [liquidationHistory, liquidationClock],
  );
  const liquidationHistoryStart = liquidationHistory[0]?.ts;
  const availableQuick = QUICK_SYMBOLS.filter((symbol) =>
    universe.length ? universe.some((market) => market.symbol === symbol) : true,
  );
  const displayedMarkets: MarketInstrument[] = universe.length
    ? universe
    : [{ symbol: DEFAULT_SYMBOL, baseCoin: "BTC", quoteCoin: "USDT", exchanges: [...LIVE_EXCHANGES] }];

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">MERCADOS DE DERIVADOS · PERPETUOS</p>
          <h1>Market Intelligence</h1>
        </div>
        <div className="status-cluster">
          {sources.map((source) => (
            <span
              className={`source ${source.connected ? "up" : "down"}`}
              key={source.exchange}
              title={source.detail}
            >
              <i /> {EXCHANGE_LABELS[source.exchange]} · {connectionLabel(source)}
            </span>
          ))}
          <span className="public-badge">DATOS PÚBLICOS · $0</span>
        </div>
      </header>

      <section className="selector-panel">
        <div className="selector-copy">
          <span className="kicker">MERCADO</span>
          <h2>Elegí una moneda y analizá el mercado en vivo.</h2>
          <p>
            La página combina fuentes públicas de varios exchanges para el perpetuo USDT seleccionado.
            Sólo se abren los feeds pesados del par activo para mantener la interfaz rápida aunque el
            universo tenga cientos de mercados.
          </p>
        </div>
        <div className="market-picker">
          <label htmlFor="market-select">Par</label>
          <select
            id="market-select"
            value={selectedSymbol}
            onChange={(event) => setSelectedSymbol(event.target.value)}
          >
            {displayedMarkets.map((market) => (
              <option key={market.symbol} value={market.symbol}>
                {market.baseCoin}/USDT
              </option>
            ))}
          </select>
          <small>
            {universe.length
              ? `${universe.length} mercados detectados`
              : "Cargando mercados disponibles…"}
          </small>
        </div>
      </section>

      <nav className="quick-markets" aria-label="Mercados rápidos">
        {availableQuick.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={selectedSymbol === symbol ? "active" : ""}
            onClick={() => setSelectedSymbol(symbol)}
          >
            {symbol.replace("USDT", "")}
          </button>
        ))}
      </nav>

      <section className="market-hero">
        <div className="market-title">
          <div className="asset-icon">{selectedSymbol.slice(0, 1)}</div>
          <div>
            <span className="kicker">PERPETUO USDT</span>
            <h2>
              {selectedSymbol.replace("USDT", "")}
              <small>/USDT</small>
            </h2>
          </div>
        </div>
        <div className="price-block">
          <span>PRECIO DE MARCA</span>
          <strong>{currentPrice == null ? "—" : `$${formatPrice(currentPrice)}`}</strong>
          <small>{snapshot?.ts ? `Actualizado ${formatTime(snapshot.ts)}` : "Esperando datos…"}</small>
        </div>
        <div className="summary-strip">
          <Metric label="Mejor compra de referencia" value={formatPrice(referenceTop?.bid)} tone="positive" />
          <Metric label="Mejor venta de referencia" value={formatPrice(referenceTop?.ask)} tone="negative" />
          <Metric
            label={referenceTop ? `Spread · ${EXCHANGE_LABELS[referenceTop.exchange]}` : "Spread"}
            value={formatPrice(referenceTop?.spread)}
          />
          <Metric label="Interés abierto Bybit (USD)" value={formatMoney(bybit?.openInterestValue)} />
          <Metric label="Interés abierto Binance (USD)" value={formatMoney(binance?.openInterestValue)} />
          <Metric
            label="Tasa de financiación"
            value={formatFunding(bybit?.fundingRate ?? okx?.fundingRate)}
            tone={fundingTone(bybit?.fundingRate ?? okx?.fundingRate)}
          />
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel heatmap-panel">
          <div className="panel-head liquidation-panel-head">
            <div>
              <span className="kicker">MAPA DE LIQUIDACIONES ESTIMADAS</span>
              <h3>Zonas donde podría concentrarse el riesgo de liquidación</h3>
              <p>
                Las bandas estiman exposición por nivel de precio a partir de velas e interés abierto
                histórico. Las velas se dibujan encima para conservar el contexto real del mercado.
              </p>
            </div>
            <div className="map-controls">
              <div className="segmented">
                {LIQUIDATION_SOURCES.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={liquidationSource === option.value ? "active" : ""}
                    onClick={() => setLiquidationSource(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="segmented">
                {LIQUIDATION_HOURS.map((hours) => (
                  <button
                    type="button"
                    key={hours}
                    className={liquidationHours === hours ? "active" : ""}
                    onClick={() => setLiquidationHours(hours)}
                  >
                    {hours} h
                  </button>
                ))}
              </div>
            </div>
          </div>
          <LiquidationHeatmap
            symbol={selectedSymbol}
            hours={liquidationHours}
            source={liquidationSource}
          />
        </article>

        <article className="panel orderbook-panel">
          <div className="panel-head compact-head">
            <div>
              <span className="kicker">LIBRO DE ÓRDENES AGREGADO</span>
              <h3>Profundidad visible</h3>
            </div>
            <div className="segmented exchange-filter">
              {ORDERBOOK_SOURCES.map((exchange) => (
                <button
                  type="button"
                  key={exchange}
                  className={exchangeFilter === exchange ? "active" : ""}
                  onClick={() => setExchangeFilter(exchange)}
                >
                  {exchange === "all" ? "Todos" : EXCHANGE_LABELS[exchange]}
                </button>
              ))}
            </div>
          </div>
          <div className="bucket-line">
            Agrupación del libro: <b>{formatPrice(aggregated.bucketSize)}</b>
          </div>
          <div className="orderbook-columns">
            <OrderSide title="Ventas" levels={aggregated.asks} side="ask" />
            <OrderSide title="Compras" levels={aggregated.bids} side="bid" />
          </div>
        </article>
      </section>

      <section className="liquidation-grid">
        <article className="panel liquidation-summary">
          <span className="kicker">LIQUIDACIONES OBSERVADAS · {selectedSymbol.replace("USDT", "")}</span>
          <h3>Totales móviles por ventana</h3>
          <div className="liquidation-window-grid">
            {liquidationWindows.map((window) => (
              <div className="liquidation-window-card" key={window.hours}>
                <div className="liquidation-window-head">
                  <span>{window.hours} h</span>
                  <strong>{formatMoney(window.total)}</strong>
                </div>
                <div className="liquidation-window-row">
                  <span>Largos</span>
                  <b className="negative">{formatMoney(window.long)}</b>
                </div>
                <div className="liquidation-window-row">
                  <span>Cortos</span>
                  <b className="positive">{formatMoney(window.short)}</b>
                </div>
                <small>{window.events} eventos observados</small>
              </div>
            ))}
          </div>
          <p className="muted-note">
            Historial local de hasta 24 h para el par seleccionado. Se conserva en este navegador;
            si la pestaña estuvo cerrada o este par no estaba activo, puede haber huecos.
            {liquidationHistoryStart
              ? ` Datos disponibles desde ${formatDateTime(liquidationHistoryStart)}.`
              : " El historial empieza a construirse con los próximos eventos."}
          </p>
        </article>

        <article className="panel recent-liquidations">
          <div className="panel-head compact-head">
            <div>
              <span className="kicker">ÚLTIMOS EVENTOS</span>
              <h3>Liquidaciones en vivo</h3>
            </div>
          </div>
          <div className="liquidation-table">
            <div className="table-row table-header">
              <span>Hora</span>
              <span>Fuente</span>
              <span>Posición</span>
              <span>Precio</span>
              <span>Nocional</span>
            </div>
            {[...liquidations]
              .reverse()
              .slice(0, 12)
              .map((item, index) => (
                <div className="table-row" key={`${item.exchange}-${item.ts}-${index}`}>
                  <span>{formatTime(item.ts)}</span>
                  <span className="exchange-name">{EXCHANGE_LABELS[item.exchange]}</span>
                  <span className={item.side === "long" ? "negative" : "positive"}>
                    {item.side === "long" ? "Largo" : "Corto"}
                  </span>
                  <span>{formatPrice(item.price)}</span>
                  <span>{formatMoney(item.notional)}</span>
                </div>
              ))}
            {!liquidations.length && (
              <div className="empty-row">Esperando liquidaciones observadas…</div>
            )}
          </div>
        </article>
      </section>

      <footer>
        <span>INTELIGENCIA DE MERCADO · SOLO LECTURA</span>
        <span>
          El mapa de liquidaciones es un modelo estimado con datos públicos, no una lista de
          posiciones individuales ni una garantía de liquidaciones futuras.
        </span>
      </footer>
    </main>
  );
}

function OrderSide({
  title,
  levels,
  side,
}: {
  title: string;
  levels: AggregatedOrderLevel[];
  side: "bid" | "ask";
}) {
  const maxNotional = Math.max(1, ...levels.map((level) => level.notional));
  return (
    <div className={`order-side ${side}`}>
      <div className="order-side-title">
        <span>{title}</span>
        <span>Nocional</span>
      </div>
      {levels.slice(0, 16).map((level) => (
        <div className="order-row" key={`${side}-${level.price}`}>
          <div
            className="depth-bar"
            style={{ width: `${Math.max(2, (level.notional / maxNotional) * 100)}%` }}
          />
          <span>{formatPrice(level.price)}</span>
          <b>{formatMoney(level.notional)}</b>
        </div>
      ))}
      {!levels.length && <div className="empty-row">Esperando libro…</div>}
    </div>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

function bestConsistentTop(
  books: NormalizedOrderBook[],
): { exchange: Exchange; bid: number; ask: number; spread: number } | null {
  const candidates = books.flatMap((book) => {
    const bid = book.bids[0]?.price;
    const ask = book.asks[0]?.price;
    if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) {
      return [];
    }
    return [{ exchange: book.exchange, bid, ask, spread: ask - bid }];
  });
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => (item.spread < best.spread ? item : best));
}

function connectionLabel(source: SourceStatus): string {
  if (source.state === "live") return "en vivo";
  if (source.state === "reconnecting") return "reconectando";
  if (source.state === "unavailable") return "no disponible";
  return "conectando";
}

function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${compact.format(value)}`;
}

function formatPrice(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const decimals = value >= 1000 ? 2 : value >= 1 ? 4 : 8;
  return value.toLocaleString("es-AR", { maximumFractionDigits: decimals });
}

function formatFunding(value?: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(4)}%`;
}

function fundingTone(value?: number | null): string {
  if (value == null || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}
