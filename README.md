# Market Intelligence Dashboard

Dashboard privado de inteligencia de mercado crypto para un grupo reducido.

## Fuente de verdad del proyecto

La especificación funcional y técnica del MVP está en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

Antes de implementar cualquier cambio, leer ese documento completo.

## Alcance inicial

- Frontend: Next.js + TypeScript
- Backend: Python + FastAPI + asyncio
- Exchanges: Binance, Bybit, BingX y Bitunix
- Activos iniciales: BTC, ETH y SOL
- Datos live por WebSocket/REST
- Sin PostgreSQL en el MVP
- Sin CoinGlass
- Sin trading real en el MVP

## Deploy objetivo

- `apps/web` -> Vercel
- `services/api` -> Railway

## Regla importante

No confundir:

- Liquidity Heatmap
- Observed Liquidations
- Estimated Liquidation Heatmap

Son módulos distintos y deben mostrarse como tales.
