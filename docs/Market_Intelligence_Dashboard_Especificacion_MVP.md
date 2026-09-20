# Market Intelligence Dashboard — Especificación MVP

**Versión:** 1.0  
**Fecha:** 20/09/2026  
**Objetivo:** dashboard privado de inteligencia de mercado crypto para un grupo reducido, sin dependencia de CoinGlass y sin PostgreSQL en el MVP.

> Este archivo es una versión de trabajo orientada a Codex. El DOCX asociado contiene el mismo alcance con formato de presentación.

## Decisiones cerradas

- Frontend: **Next.js + TypeScript**, deploy en **Vercel**.
- Backend/worker persistente: **Python + FastAPI + asyncio**, deploy inicial recomendado en **Railway**.
- Persistencia MVP: **sin PostgreSQL**. Estado live + ring buffers en RAM. Redis/Upstash sólo si aparece una necesidad concreta.
- Exchanges iniciales: **Binance, Bybit, BingX, Bitunix**.
- Activos iniciales: **BTC, ETH, SOL**.
- CoinGlass: **no consumir ni scrapear**.
- Trading real: **fuera del MVP**; todo read-only.
- Diferenciar siempre:
  - **Liquidity Heatmap** = órdenes limit visibles reales del order book.
  - **Observed Liquidations** = liquidaciones publicadas por exchange.
  - **Estimated Liquidation Heatmap** = modelo propio, no dato exacto.

## Arquitectura

```text
Binance / Bybit / BingX / Bitunix / Fed / BLS / BEA / SEC / GDELT
                            |
                            v
             FastAPI Market Worker (24/7)
             - adapters por exchange
             - normalización
             - ring buffers RAM
             - heatmaps
             - news/macro
                            |
                     REST + WebSocket
                            |
                            v
                    Next.js / Vercel
```

## APIs principales

### Binance USD-M
- Depth WS: `wss://fstream.binance.com/public/ws/{symbol}@depth@100ms`
- Liquidations: `wss://fstream.binance.com/market/ws/!forceOrder@arr`
  - Limitación documentada: sólo la última liquidación por símbolo dentro de cada ventana de 1000 ms.
- Open Interest: `GET /fapi/v1/openInterest?symbol=BTCUSDT`

### Bybit
- Orderbook topic: `orderbook.50.BTCUSDT` o `orderbook.200.BTCUSDT`
- Liquidations: `allLiquidation.BTCUSDT`
- Ticker: `tickers.BTCUSDT` (markPrice, openInterestValue, fundingRate, nextFundingTime)
- OI histórico: `GET /v5/market/open-interest`

### BingX Perpetual
- WS: `wss://open-api-swap.bingx.com/swap-market`
- Depth: `BTC-USDT@depth20@200ms`
- Incremental depth: `BTC-USDT@incrDepth`
- REST OI: `GET /openApi/swap/v2/quote/openInterest`
- REST funding/mark: `GET /openApi/swap/v2/quote/premiumIndex`
- Mensajes WS GZIP.

### Bitunix Futures
- WS: `wss://fapi.bitunix.com/public/`
- Depth: channel `depth_books`
- Trades: channel `trade`
- Price/funding: channel `price`
- REST depth: `GET /api/v1/futures/market/depth`

## Fuentes macro/noticias

- Fed FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Fed RSS: https://www.federalreserve.gov/feeds/feeds.htm
- BLS release calendar / ICS: https://www.bls.gov/schedule/news_release/empsit.htm
- BLS API: https://www.bls.gov/developers/
- BEA releases: https://www.bea.gov/news/schedule
- BEA API: https://apps.bea.gov/api/signup/
- SEC press releases: https://www.sec.gov/newsroom/press-releases
- GDELT DOC 2.0: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- Fear & Greed: https://alternative.me/crypto/fear-and-greed-index/

## Backend: modelos normalizados

```python
@dataclass
class OrderLevel:
    price: float
    qty: float
    notional: float

@dataclass
class NormalizedOrderBook:
    exchange: str
    symbol: str
    ts: int
    bids: list[OrderLevel]
    asks: list[OrderLevel]
    sequence: str | int | None = None

@dataclass
class LiquidationEvent:
    exchange: str
    symbol: str
    ts: int
    side: Literal["long", "short"]
    price: float
    qty: float
    notional: float
    source_quality: Literal["all", "snapshot"]
```

## Order book agregado

1. Mapear símbolos de exchange a símbolo interno.
2. Calcular `notional = price * qty`.
3. Agrupar precios por buckets configurables.
4. Sumar bids/asks por bucket y conservar desglose por exchange.
5. No mezclar spot/perpetual sin indicar el tipo.

## Liquidity Heatmap

- Snapshot cada 1-5 s.
- Ring buffer de 2-6 h.
- Matriz: X tiempo, Y precio, valor nocional.
- Intensidad con `log1p(notional)` o percentiles.
- Añadir persistencia de pared.
- No interpretar pared como garantía de ejecución.

## Liquidaciones observadas

- Bybit `allLiquidation` = fuente completa del exchange según documentación.
- Binance `!forceOrder@arr` = cobertura parcial/snapshot por su regla de 1 s.
- Agregar por 15m / 1h / 4h / 24h, símbolo, exchange y lado.

## Estimated Liquidation Heatmap v1

Entradas:
- mark price
- open interest + delta OI
- trades / taker imbalance
- funding
- long/short ratio cuando exista
- liquidaciones observadas

Proceso inicial:
1. Detectar incrementos de OI.
2. Distribuir nuevo OI alrededor de precios recientes.
3. Estimar peso long/short con taker imbalance + funding normalizado + otros inputs disponibles.
4. Distribuir leverage en canasta configurable: 3x, 5x, 10x, 20x, 50x, 100x.
5. Liquidación aproximada:
   - `long_liq ≈ entry * (1 - 1/L + mmr_adjustment)`
   - `short_liq ≈ entry * (1 + 1/L - mmr_adjustment)`
6. Acumular densidad por price bucket.
7. Calibrar pesos con eventos de liquidación observados posteriores.

**Nunca presentar como precio de liquidación exacto.**

## Estado en memoria

- `order_books`: estado actual.
- `trades`: 15-60 min.
- `liquidations`: 24 h.
- `liquidity_heatmap`: 2-6 h.
- `liquidation_heatmap`: 2-6 h.
- `metrics`: estado + muestras cortas.
- `news`: 24-72 h cache.
- `macro_events`: 30-90 días cache.

Se acepta perder este histórico si el backend reinicia.

## API interna sugerida

- `GET /api/health`
- `GET /api/symbols`
- `GET /api/market/{symbol}/snapshot`
- `GET /api/orderbook/{symbol}?exchange=all&depth=50`
- `GET /api/liquidations/{symbol}?window=1h`
- `GET /api/heatmap/liquidity/{symbol}`
- `GET /api/heatmap/liquidations/{symbol}`
- `GET /api/macro/events?days=14`
- `GET /api/news?limit=50`
- `WS /ws/market?symbols=BTCUSDT,ETHUSDT,SOLUSDT`

WS events:
- `ticker.update`
- `orderbook.update`
- `liquidation.event`
- `metrics.update`
- `liquidity_heatmap.update`
- `liquidation_heatmap.update`
- `news.new`
- `macro.update`
- `source.status`

## Frontend MVP

Páginas:
1. Dashboard
2. Liquidity Heatmap
3. Liquidations
4. Order Book
5. Macro & News

Requisitos:
- dark mode
- desktop-first responsive
- timestamps y source health visibles
- degradación por módulo si falla una fuente
- etiquetas explícitas Observed vs Estimated

## Deploy

```text
apps/web     -> Vercel
services/api -> Railway (Docker, proceso persistente)
```

Redis/Upstash sólo si se necesita multi-instancia o TTL compartido.

## Orden de implementación

1. Monorepo + Docker backend.
2. Modelos normalizados + symbol mapper.
3. Binance depth + liquidation.
4. Bybit orderbook + allLiquidation + ticker.
5. State manager + reconexión.
6. REST + WS interno.
7. Next.js dashboard básico.
8. Order book agregado.
9. Liquidity Heatmap.
10. Liquidaciones observadas.
11. Estimated Liquidation Heatmap v1.
12. BingX.
13. Bitunix.
14. Macro + news.
15. Tests + deploy.

## Reglas de implementación

- No PostgreSQL en MVP.
- No CoinGlass.
- No trading real.
- No secretos en frontend/git.
- Preferir WS a polling cuando exista.
- Validar continuidad de sequences para depth incremental.
- Un adaptador caído no puede afectar a los demás.
- UI sólo consume formatos normalizados internos.
