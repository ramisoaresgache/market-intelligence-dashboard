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

## Flujos de capital con fuentes públicas

CoinGlass no es una dependencia del proyecto. Los enlaces compartidos se toman sólo como referencia funcional para decidir qué información mostrar.

### BTC entrando y saliendo de exchanges

La ruta `/api/capital-flows` consulta Coin Metrics Community API sin API key y utiliza métricas diarias de BTC:

- `FlowInExUSD` / `FlowInExNtv`: entradas hacia direcciones identificadas como exchanges.
- `FlowOutExUSD` / `FlowOutExNtv`: salidas desde exchanges.
- `SplyExNtv` / `SplyExUSD`: reserva/supply identificado en exchanges cuando está disponible en Community.

La UI muestra entradas, salidas, netflow diario, netflow de 7 días y reservas de BTC cuando la fuente las expone.

Estas métricas dependen del etiquetado de direcciones de Coin Metrics y pueden revisarse históricamente cuando se identifican nuevas direcciones de exchanges.

### ETF spot cripto

La misma ruta consulta las páginas públicas de Farside Investors para:

- ETF spot de BTC.
- ETF spot de ETH.
- ETF spot de SOL.

El servidor extrae el total diario publicado y calcula acumulados de 5 y 7 jornadas. La interfaz mantiene la atribución explícita a Farside y, si cambia el formato de la página, muestra el error en lugar de fabricar datos.

No se requiere API key ni plan pago para este módulo.

## Variables

```env
LIQUIDATION_COLLECTOR_URL=https://market-intelligence-dashboard.godino290.workers.dev
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
