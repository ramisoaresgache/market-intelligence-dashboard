# Market Intelligence Dashboard

Plataforma pública y **read-only** de inteligencia de mercados crypto.

El objetivo es concentrar en una sola web datos que normalmente están repartidos entre exchanges, CoinGlass, Investing y múltiples fuentes de noticias/macro, pero sin depender de CoinGlass ni de un backend persistente pago.

## Fuente de verdad

La especificación actual del proyecto está en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

La arquitectura vigente es **frontend-first** y está diseñada para funcionar con coste de infraestructura inicial de **USD 0**.

## Arquitectura objetivo

```text
Vercel / Next.js
      │
      ├── Browser Market Engine
      │     ├── Binance WebSocket
      │     ├── Bybit WebSocket
      │     ├── BingX (fase posterior)
      │     └── Bitunix (fase posterior)
      │
      ├── Web Worker
      ├── IndexedDB
      │
      └── Serverless Route Handlers
            ├── FED
            ├── SEC
            ├── GDELT
            └── Macro
```

Los streams públicos de mercado se consumen directamente desde el navegador cuando sea técnicamente posible. Vercel Functions se reservan para noticias, macro, RSS, normalización y fuentes que no admitan consumo browser-side.

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

Validaciones mínimas antes de mergear:

```bash
npm run lint
npm run typecheck
npm run build:web
```

Las instrucciones específicas de migración se encuentran en:

`docs/CODEX_TASK_FRONTEND_FIRST.md`
