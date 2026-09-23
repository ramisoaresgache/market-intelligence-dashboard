"use client";

import { useEffect, useMemo, useState } from "react";
import { CapitalFlows } from "../components/capital-flows";
import { ChartCaptureManager } from "../components/chart-capture-manager";
import { LiquidationHeatmap } from "../components/liquidation-heatmap";
import { LiquidationSummary } from "../components/liquidation-summary";
import { LiquidityHeatmap } from "../components/liquidity-heatmap";
import { MarketPulse } from "../components/market-pulse";
import {
  aggregateOrderBooks,
  midpointFromBooks,
  type ExchangeFilter,
} from "../lib/market/engine/aggregate";
import type { LiquidationMapSource } from "../lib/market/liquidation-model";
import { DEFAULT_SYMBOL } from "../lib/market/symbols";
import {
  LIVE_EXCHANGES,
  type AggregatedOrderLevel,
  type Exchange,
  type MarketInstrument,
  type SourceStatus,
} from "../lib/market/types";
import { loadMarketUniverse } from "../lib/market/universe";
import { useLiquidityHistory } from "../lib/market/use-liquidity-history";
import { setMarketSymbol, useMarketEngine } from "../lib/market/use-market-engine";

const compact = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const EMPTY_BOOKS: NonNullable<ReturnType<typeof useMarketEngine>["snapshots"][string]>["orderBooks"] = [];
const LIQUIDATION_HOURS = [4, 12, 24] as const;
const LIQUIDATION_SOURCES: Array<{ value: LiquidationMapSource; label: string }> = [
  { value: "aggregate", label: "Binance + Bybit + OKX" },
  { value: "binance", label: "Binance" },
  { value: "bybit", label: "Bybit" },
  { value: "okx", label: "OKX" },
];
const ORDERBOOK_SOURCES: ExchangeFilter[] = ["all", ...LIVE_EXCHANGES];
const LIQUIDITY_WINDOWS = [
  { label: "15 m", value: 15 * 60 * 1000 },
  { label: "1 h", value: 60 * 60 * 1000 },
  { label: "4 h", value: 4 * 60 * 60 * 1000 },
] as const;
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
  const [marketSearch, setMarketSearch] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>("all");
  const [liquidityWindowMs, setLiquidityWindowMs] = useState<number>(LIQUIDITY_WINDOWS[1].value);
  const [liquidationHours, setLiquidationHours] = useState<(typeof LIQUIDATION_HOURS)[number]>(24);
  const [liquidationSource, setLiquidationSource] = useState<LiquidationMapSource>("aggregate");

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

  const snapshot = snapshots[selectedSymbol];
  const books = snapshot?.orderBooks ?? EMPTY_BOOKS;
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
  const liquidityBooks = useMemo(
    () => exchangeFilter === "all" ? books : books.filter((book) => book.exchange === exchangeFilter),
    [books, exchangeFilter],
  );
  const liquidityHistoryKey = `${selectedSymbol}::${exchangeFilter}`;
  const liquidityFrames = useLiquidityHistory(liquidityHistoryKey, liquidityBooks);
  const liquidityPrice = midpointFromBooks(liquidityBooks) ?? currentPrice;
  const liquidations = snapshot?.liquidations ?? [];
  const availableQuick = QUICK_SYMBOLS.filter((symbol) =>
    universe.length ? universe.some((market) => market.symbol === symbol) : true,
  );
  const displayedMarkets: MarketInstrument[] = universe.length
    ? universe
    : [{ symbol: DEFAULT_SYMBOL, baseCoin: "BTC", quoteCoin: "USDT", exchanges: [...LIVE_EXCHANGES] }];
  const normalizedSearch = marketSearch.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const filteredMarkets = normalizedSearch
    ? displayedMarkets.filter(
        (market) => market.symbol.includes(normalizedSearch) || market.baseCoin.includes(normalizedSearch),
      )
    : displayedMarkets;
  const selectedMarket = displayedMarkets.find((market) => market.symbol === selectedSymbol);
  const pickerMarkets =
    selectedMarket && !filteredMarkets.some((market) => market.symbol === selectedSymbol)
      ? [selectedMarket, ...filteredMarkets]
      : filteredMarkets;

  function selectFirstSearchResult() {
    const first = filteredMarkets[0];
    if (!first) return;
    setSelectedSymbol(first.symbol);
    setMarketSearch("");
  }

  return (
    <main>
      <ChartCaptureManager />

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
          <label htmlFor="market-search">Buscar par</label>
          <input
            id="market-search"
            type="search"
            value={marketSearch}
            placeholder="BTC, ETH, SOL…"
            onChange={(event) => setMarketSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") selectFirstSearchResult();
            }}
          />
          <label htmlFor="market-select">Par</label>
          <select
            id="market-select"
            value={selectedSymbol}
            onChange={(event) => {
              setSelectedSymbol(event.target.value);
              setMarketSearch("");
            }}
          >
            {pickerMarkets.map((market) => (
              <option key={market.symbol} value={market.symbol}>
                {market.baseCoin}/USDT
              </option>
            ))}
          </select>
          <small>
            {universe.length
              ? `${filteredMarkets.length} de ${universe.length} mercados`
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
            onClick={() => {
              setSelectedSymbol(symbol);
              setMarketSearch("");
            }}
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
        <MarketPulse symbol={selectedSymbol} currentPrice={currentPrice} />
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

      <section className="panel liquidity-history-panel">
        <div className="panel-head liquidation-panel-head">
          <div>
            <span className="kicker">HEATMAP DEL LIBRO DE ÓRDENES</span>
            <h3>Liquidez límite visible a través del tiempo</h3>
            <p>
              El navegador conserva muestras locales de 5 s y las combina con snapshots centrales de
              Cloudflare para mostrar continuidad histórica sin perder el detalle del momento actual.
            </p>
          </div>
          <div className="map-controls">
            <div className="segmented">
              {ORDERBOOK_SOURCES.map((exchange) => (
                <button
                  type="button"
                  key={`heatmap-${exchange}`}
                  className={exchangeFilter === exchange ? "active" : ""}
                  onClick={() => setExchangeFilter(exchange)}
                >
                  {exchange === "all" ? "Todos" : EXCHANGE_LABELS[exchange]}
                </button>
              ))}
            </div>
            <div className="segmented">
              {LIQUIDITY_WINDOWS.map((window) => (
                <button
                  type="button"
                  key={window.value}
                  className={liquidityWindowMs === window.value ? "active" : ""}
                  onClick={() => setLiquidityWindowMs(window.value)}
                >
                  {window.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <LiquidityHeatmap
          frames={liquidityFrames}
          windowMs={liquidityWindowMs}
          currentPrice={liquidityPrice}
        />
        <p className="panel-footnote liquidity-footnote">
          Órdenes limit visibles y cancelables. El histórico fino se conserva localmente en IndexedDB;
          Cloudflare aporta snapshots de un minuto para continuidad 24/7 cuando existe cobertura central.
        </p>
      </section>

      <section className="liquidation-grid">
        <LiquidationSummary symbol={selectedSymbol} liquidations={liquidations} />

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

      <CapitalFlows />

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

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}
