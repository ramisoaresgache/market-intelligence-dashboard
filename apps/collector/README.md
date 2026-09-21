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
- `GET /v1/diagnostics/binance` — diagnóstico del collector principal contra Binance.
- `GET /v1/diagnostics/binance-regions` — prueba REST + WebSocket de Binance desde Durable Objects nuevos con hints `weur`, `apac` y `wnam`.

### Diagnóstico regional de Binance

Los probes regionales están separados del collector principal. No crean alarmas, no abren Bybit y no escriben buckets de liquidaciones. Cada probe usa un nombre versionado porque Cloudflare sólo toma `locationHint` en la primera creación de cada Durable Object y el hint es best-effort.

El resultado permite distinguir entre un bloqueo general de Binance hacia Cloudflare y uno dependiente del egress/región. Si una región devuelve REST 200 y/o WebSocket 101 mientras el collector principal recibe 403, esa región queda como candidata para alojar un collector Binance separado.

## Deploy con Cloudflare Git Integration

Configuración usada actualmente en Cloudflare Workers Builds para este monorepo:

- Production branch: `main`
- Root directory: `/`
- Build command: `cd apps/collector && npm install`
- Deploy command: `cd apps/collector && npx wrangler deploy`
- Version command: `cd apps/collector && npx wrangler versions upload`
- Build watch path: `apps/collector/**`
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
