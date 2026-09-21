# Market Intelligence Collector

Collector 24/7 de liquidaciones para Cloudflare Workers + Durable Objects + SQLite.

## Objetivo

El frontend actual recibe liquidaciones por WebSocket mientras el navegador está abierto. Este servicio agrega una capa central que sigue recolectando datos independientemente de la PC del usuario y persiste buckets de 1 minuto en SQLite.

### Fuentes iniciales

- Binance USD-M Futures: stream público global `!forceOrder@arr`.
- Bybit Linear: `allLiquidation.{symbol}`.

No se presenta esta cobertura como equivalente a CoinGlass: cada exchange expone distinta granularidad de liquidaciones públicas.

## Símbolos iniciales

- BTCUSDT
- ETHUSDT
- SOLUSDT
- BNBUSDT
- XRPUSDT
- DOGEUSDT

Se configuran en `wrangler.jsonc` mediante `COLLECTOR_SYMBOLS`.

## Persistencia

SQLite guarda buckets de 1 minuto:

- exchange
- symbol
- bucket_ts
- long_usd
- short_usd
- events

Los eventos se acumulan en memoria durante el minuto y se escriben agrupados para evitar una escritura de base por cada mensaje WebSocket. La retención inicial es de 7 días; la API expone actualmente ventanas móviles de 1 h, 4 h, 12 h y 24 h.

## Endpoints

- `GET /` — información del servicio.
- `GET /bootstrap` — instancia el Durable Object y abre los WebSockets.
- `GET /health` — estado de Binance/Bybit y almacenamiento.
- `GET /v1/liquidations/symbols` — símbolos recolectados.
- `GET /v1/liquidations/summary?symbol=BTCUSDT` — totales 1h/4h/12h/24h.

## Deploy con Cloudflare Git Integration

En Cloudflare Workers & Pages:

- Project name: `market-intelligence-collector`
- Root directory: `apps/collector`
- Build command: vacío
- Deploy command: `npx wrangler deploy`
- Production branch: `main`
- Builds for non-production branches: desactivado
- Cloudflare Access: desactivado para esta primera versión

Después del primer deploy abrir una vez:

`https://<worker>.workers.dev/bootstrap`

Eso crea/activa la instancia `primary`, inicializa SQLite y abre los WebSockets. A partir de ahí una alarma del Durable Object revisa las conexiones y vacía los buckets pendientes periódicamente.

## Desarrollo local

```bash
npm install
npm run dev
```

Validación de bundle/configuración sin desplegar:

```bash
npm run check
```
