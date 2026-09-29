# Market Intelligence Dashboard

Plataforma pública y **read-only** de inteligencia de mercados crypto.

El objetivo es concentrar en una sola web datos que normalmente están repartidos entre exchanges, CoinGlass, Investing y múltiples fuentes de noticias/macro, pero sin depender de CoinGlass ni de un backend persistente pago.

## Fuente de verdad

La especificación actual del proyecto está en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

La arquitectura vigente es **frontend-first** y está diseñada para funcionar con coste de infraestructura inicial de **USD 0**.

## Arquitectura actual

```text
Vercel / Next.js
      │
      ├── Browser Market Engine
      │     ├── Binance combined WebSocket (depth + liquidaciones)
      │     ├── Bybit WebSocket
      │     ├── BingX WebSocket (GZIP)
      │     └── Bitunix WebSocket
      │
      └── Web Worker
            └── snapshots UI cada 150 ms

Next.js Route Handler
      └── histórico OHLC Bybit (fallback OKX) · caché CDN 30 s
```

El dashboard consume Binance USD-M, Bybit Linear, BingX Perpetual y Bitunix Futures directamente desde el navegador. No necesita `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` ni FastAPI levantado.

La interfaz está dividida en vistas para evitar scroll vertical innecesario:

- **Mercado**: heatmap del libro de órdenes con velas reales y mapa estimado de liquidaciones.
- **Trading**: velas 1m/5m/15m/1h/4h/1D, volumen e indicadores MA, EMA, BOLL, RSI y MACD; histórico REST y vela actual por WebSocket.
- **Liquidaciones**: totales observados de 1h, 4h, 12h y 24h más el feed en vivo.
- **Flujos y reservas**: entradas, salidas y saldo agregado de BTC en exchanges; flujos ETF spot si se configura el proveedor.
- **Noticias**: módulo reservado, todavía sin fuentes sintéticas ni contenido inventado.

Un único `MarketConnectionManager` por pestaña inicia un Web Worker. El worker mantiene las conexiones, valida y normaliza los order books a frecuencia nativa, conserva el estado y publica un snapshot coalescido hacia React cada 150 ms. Binance agrupa los seis libros y el canal de liquidaciones en un único WebSocket combinado. Cada exchange reconecta de forma independiente con backoff, por lo que una caída parcial no detiene las demás fuentes. El mapa permite elegir `Consolidado`, `Binance`, `Bybit`, `BingX` o `Bitunix`; el filtro se aplica tanto al historial de Cloudflare como al libro en vivo.

La vista Trading usa KLineChart en el navegador. `/api/candles` normaliza el histórico de Bybit Linear y usa OKX Perpetual como fallback; la respuesta aprovecha la caché de Vercel/Next y el navegador conserva hasta 2.000 velas por símbolo/temporalidad en IndexedDB. La vela abierta llega directamente desde el WebSocket público de Bybit. No se usa Durable Objects ni un proceso Python permanente para esta función.

El backend FastAPI permanece en `services/api` sólo como referencia de migración y no fue eliminado en este PR.

### Fuentes browser-side implementadas

- Binance USD-M: un WebSocket combinado para depth incremental de todos los símbolos y `!forceOrder@arr`, más snapshots y open interest REST.
- Bybit Linear: `orderbook.50`, `allLiquidation`, `tickers` (mark/last, open interest y funding) y velas live de la vista Trading.
- OKX Perpetual: fallback REST para el histórico OHLC.
- BingX Perpetual: snapshots públicos `depth100`, descompresión GZIP y heartbeat Ping/Pong.
- Bitunix Futures: `depth_books` público incremental y heartbeat explícito.
- Símbolos: BTCUSDT, ETHUSDT, SOLUSDT, BCHUSDT, BNBUSDT y XRPUSDT.

Las liquidaciones de Binance se etiquetan como cobertura parcial (`snapshot`). Las de Bybit se etiquetan como cobertura completa declarada por la fuente (`all`). BingX y Bitunix aportan libro de órdenes, pero no se presentan como fuentes de liquidaciones observadas porque su documentación pública actual no ofrece un canal equivalente.

## Módulos objetivo

- BTC / ETH / SOL live
- Order Book por exchange y agregado
- Observed Liquidations
- Liquidity Heatmap
- Estimated Liquidation Heatmap propio
- Open Interest
- Funding
- noticias de alto impacto
- FED / SEC
- calendario macro
- overview de mercado

## Regla clave

No confundir:

- **Liquidity Heatmap**: órdenes limit visibles reales.
- **Observed Liquidations**: liquidaciones reportadas por exchanges.
- **Estimated Liquidation Heatmap**: modelo propio de zonas potenciales, no dato exacto.

## Estado del repositorio

La primera versión implementó un backend FastAPI con Binance y Bybit. Esa implementación se conserva temporalmente como referencia mientras se migra a browser-side.

No eliminar `services/api` hasta comprobar paridad funcional en el frontend.

## Deploy

Objetivo MVP v2:

```text
GitHub -> Vercel
```

Sin Railway.
Sin Google Cloud VM.
Sin PostgreSQL.
Sin Redis.
Sin servidor always-on.

## Desarrollo

Frontend:

```bash
npm install
npm run dev:web
```

Abrir `http://localhost:3000`. No hay variables de entorno obligatorias y no hace falta iniciar `services/api`.

Variables opcionales en `apps/web/.env.local`:

```env
LIQUIDATION_COLLECTOR_URL=https://market-intelligence-dashboard.godino290.workers.dev
SOSOVALUE_API_KEY=
```

El collector público de Cloudflare tiene un valor por defecto, por lo que los históricos de order book y liquidaciones funcionan sin configuración local. `SOSOVALUE_API_KEY` es necesaria únicamente para mostrar los flujos reales de ETF BTC, ETH y SOL; nunca debe declararse con prefijo `NEXT_PUBLIC_`.

Validaciones:

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```

### Compatibilidad browser verificada

Smoke test local realizado con FastAPI apagado:

- Binance WebSocket y REST públicos: conexión directa correcta desde navegador.
- Bybit WebSocket público: conexión directa correcta desde navegador.
- BingX WebSocket público: conexión directa correcta, incluyendo frames GZIP y Ping/Pong.
- Bitunix WebSocket público: conexión directa correcta con `depth_books` y heartbeat.
- No se observaron bloqueos de `Origin` ni de CORS para las fuentes usadas.

La disponibilidad final sigue dependiendo de la red del visitante y de los endpoints públicos de cada exchange. La UI muestra el estado `connecting`, `live` o `reconnecting` por fuente.

Las instrucciones específicas de migración se encuentran en:

`docs/CODEX_TASK_FRONTEND_FIRST.md`
