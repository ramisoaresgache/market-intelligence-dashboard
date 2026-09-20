# Market Intelligence Dashboard

Plataforma pública y **read-only** de inteligencia de mercados crypto.

El objetivo es concentrar en una sola web datos que normalmente están repartidos entre exchanges, CoinGlass, Investing y múltiples fuentes de noticias/macro, pero sin depender de CoinGlass ni de un backend persistente pago.

## Fuente de verdad

La especificación actual del proyecto está en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

La arquitectura vigente es **frontend-first** y está diseñada para funcionar con coste de infraestructura inicial de **USD 0**.

## Arquitectura actual (PR 2)

```text
Vercel / Next.js
      │
      ├── Browser Market Engine
      │     ├── Binance WebSocket
      │     └── Bybit WebSocket
      │
      └── Web Worker
            └── snapshots UI cada 150 ms
```

El dashboard ya consume Binance USD-M y Bybit Linear directamente desde el navegador. No necesita `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` ni FastAPI levantado.

Un único `MarketConnectionManager` por pestaña inicia un Web Worker. El worker mantiene las conexiones, valida y normaliza los order books a frecuencia nativa, conserva el estado y publica un snapshot coalescido hacia React cada 150 ms. Cada exchange reconecta de forma independiente con backoff, por lo que una caída parcial no detiene la otra fuente.

El backend FastAPI permanece en `services/api` sólo como referencia de migración y no fue eliminado en este PR.

### Fuentes browser-side implementadas

- Binance USD-M: depth incremental + snapshot REST, `!forceOrder@arr` y open interest REST.
- Bybit Linear: `orderbook.50`, `allLiquidation` y `tickers` (mark/last, open interest y funding).
- Símbolos: BTCUSDT, ETHUSDT y SOLUSDT.

Las liquidaciones de Binance se etiquetan como cobertura parcial (`snapshot`). Las de Bybit se etiquetan como cobertura completa declarada por la fuente (`all`).

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
- No se observaron bloqueos de `Origin` ni de CORS para las fuentes usadas.

La disponibilidad final sigue dependiendo de la red del visitante y de los endpoints públicos de cada exchange. La UI muestra el estado `connecting`, `live` o `reconnecting` por fuente.

Las instrucciones específicas de migración se encuentran en:

`docs/CODEX_TASK_FRONTEND_FIRST.md`
