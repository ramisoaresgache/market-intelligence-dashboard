# PR #17 — Liquidaciones e insights de mercado

## Objetivo

Centralizar los totales de liquidaciones 1h / 4h / 12h / 24h y aplicar los cambios visuales pedidos para la vista principal sin depender de que el navegador permanezca abierto.

## Liquidaciones 24/7

### Fuentes activas

- Bybit `allLiquidation.{symbol}`.
- Gate.io `futures.public_liquidates` con normalización por `quanto_multiplier`.
- BitMEX `liquidation`, inicialmente sólo `XBTUSD` → `BTCUSDT` para evitar interpretar incorrectamente el valor de contratos de otros instrumentos.

### Binance

Binance no participa de la recolección activa. El collector principal y los probes regionales en Western Europe, Asia-Pacific y Western North America recibieron HTTP 403 tanto por REST como por WebSocket Upgrade. El diagnóstico permanece disponible, pero se eliminan los reintentos permanentes.

### Persistencia

Cloudflare Durable Objects + SQLite mantiene buckets de un minuto y expone ventanas móviles de 1h, 4h, 12h y 24h. La web consulta el collector mediante `/api/liquidations`. Si la API central no responde, se conserva como fallback el historial local del navegador.

## Cambios de interfaz

- El bloque de métricas de la derecha del hero se reemplaza por un gráfico de línea de las últimas 24 horas.
- Se muestra variación diaria porcentual y variación absoluta en USDT.
- Se muestran sesiones de Asia/Tokio, Europa/Londres y USA/Nueva York con horario local y estado abierto/cerrado.
- Se agrega buscador de pares sobre el selector existente.
- Los totales de liquidaciones indican si provienen del histórico central o del fallback local y muestran el aporte por exchange.

## CoinGlass opcional

Se agrega un adaptador server-side `/api/coinglass` preparado para:

- histórico bid/ask de futuros;
- flujos de ETF spot de Bitcoin;
- balances de la moneda en exchanges.

La integración sólo consulta CoinGlass cuando existe `COINGLASS_API_KEY`. La clave nunca se envía al navegador. Sin clave, la UI muestra las capacidades disponibles pero no inventa valores ni scrapea endpoints privados.

Para reservas en exchanges la interfaz usa esa denominación explícita: no se presenta el balance agregado de exchanges como identificación de ballenas individuales.

## Variables

```env
LIQUIDATION_COLLECTOR_URL=https://market-intelligence-dashboard.godino290.workers.dev
COINGLASS_API_KEY=
```

## Validación

Collector:

```bash
cd apps/collector
npm install
npm run check
```

Web:

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```
