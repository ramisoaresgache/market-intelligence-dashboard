# Market Intelligence Collector

Collector 24/7 de liquidaciones para Cloudflare Workers + Durable Objects + SQLite.

## Objetivo

El frontend recibe eventos en vivo mientras el navegador está abierto. Este servicio agrega una capa central que sigue recolectando datos independientemente de la PC del usuario y persiste buckets de 1 minuto en SQLite.

## Fuentes activas

- **Bybit Linear**: canal público `allLiquidation.{symbol}`.
- **Gate.io Futures USDT**: canal público `futures.public_liquidates`; el nocional se normaliza con `quanto_multiplier` del contrato.
- **BitMEX**: tabla pública `liquidation`; por seguridad de unidades se incorpora inicialmente sólo `XBTUSD` y se normaliza como `BTCUSDT`, ya que su cantidad representa contratos con valor USD.

### Binance

Binance quedó desactivado para recolección activa desde Cloudflare. El collector principal y probes nuevos con `locationHint` en Western Europe, Asia-Pacific y Western North America recibieron HTTP 403 tanto en REST como durante el WebSocket Upgrade. Se conserva el endpoint de diagnóstico, pero ya no se generan reintentos permanentes.

No se presenta esta cobertura como equivalente a CoinGlass: cada exchange publica distinta granularidad de liquidaciones y BitMEX sólo suma BTC en esta primera versión.

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

Los eventos se acumulan en memoria durante el minuto y se escriben agrupados para evitar una escritura de base por cada mensaje WebSocket. La retención inicial es de 7 días; la API expone ventanas móviles de 1 h, 4 h, 12 h y 24 h y un desglose `byExchange`.

## Endpoints

- `GET /` — información del servicio.
- `GET /bootstrap` — instancia el Durable Object y abre las fuentes activas.
- `GET /health` — estado de Bybit, Gate.io, BitMEX, Binance desactivado y almacenamiento.
- `GET /v1/liquidations/symbols` — símbolos recolectados.
- `GET /v1/liquidations/summary?symbol=BTCUSDT` — totales 1h/4h/12h/24h.
- `GET /v1/diagnostics/binance` — estado y motivo de desactivación de Binance.
- `GET /v1/diagnostics/binance-regions` — prueba REST + WebSocket de Binance desde probes regionales.

## Deploy con Cloudflare Git Integration

Configuración usada actualmente en Cloudflare Workers Builds para este monorepo:

- Production branch: `main`
- Root directory: `/`
- Build command: `cd apps/collector && npm install`
- Deploy command: `cd apps/collector && npx wrangler deploy`
- Version command: `cd apps/collector && npx wrangler versions upload`
- Build watch path: `apps/collector/**`
- Builds for non-production branches: desactivado
- Cloudflare Access: desactivado

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
