# PR #12 — Collector 24/7 con Cloudflare

## Objetivo

Agregar un servicio separado del frontend que continúe recolectando liquidaciones aunque ningún navegador tenga abierto el dashboard.

## Arquitectura

```text
Binance / Bybit WebSocket
          ↓
Cloudflare Worker
          ↓
Durable Object `primary`
          ↓
SQLite embebido
          ↓
API HTTP de lectura
          ↓
Vercel / Next.js
```

El frontend de Next.js continúa alojado en Vercel. Cloudflare se usa exclusivamente para recolección persistente y almacenamiento central.

## Persistencia

Las liquidaciones no se guardan una por una. Se agrupan en buckets de un minuto por:

- exchange;
- símbolo;
- minuto.

Cada bucket contiene:

- USD de liquidaciones long;
- USD de liquidaciones short;
- cantidad de eventos.

Esto reduce drásticamente las escrituras y permite calcular ventanas móviles de 1 h, 4 h, 12 h y 24 h.

## Cobertura inicial

Símbolos:

- BTCUSDT
- ETHUSDT
- SOLUSDT
- BNBUSDT
- XRPUSDT
- DOGEUSDT

Exchanges con liquidaciones públicas ya usadas por el frontend:

- Binance USD-M Futures;
- Bybit Linear.

La cobertura no se presenta como equivalente a CoinGlass. Binance y Bybit publican liquidaciones con distinta granularidad.

## Recuperación

El Durable Object programa una alarma periódica. En cada ejecución:

1. vuelca buckets pendientes a SQLite;
2. elimina buckets fuera de retención;
3. revisa conexiones WebSocket;
4. reconecta fuentes caídas;
5. agenda la próxima alarma.

La retención inicial es de 7 días aunque la API pública del MVP expone hasta 24 h.

## API

- `/bootstrap`
- `/health`
- `/v1/liquidations/symbols`
- `/v1/liquidations/summary?symbol=BTCUSDT`

## Cloudflare Git Integration

Configuración esperada:

- Project name: `market-intelligence-collector`
- Production branch: `main`
- Root directory: `apps/collector`
- Build command: vacío
- Deploy command: `npx wrangler deploy`
- Builds for non-production branches: desactivado

El primer deploy provisiona el Durable Object SQLite mediante el bloque declarativo `exports` de Wrangler.
