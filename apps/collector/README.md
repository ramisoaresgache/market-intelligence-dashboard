# Market Intelligence Collector

Collector 24/7 de **liquidaciones** y **snapshots de order book** para Cloudflare Workers + Durable Objects + SQLite.

Este servicio existe para que el dashboard no dependa de que un navegador permanezca abierto. El browser sigue siendo la fuente de mayor frecuencia para el dato actual; Cloudflare conserva un histórico central más compacto y rodante.

## Arquitectura

```text
Worker público
   │
   ├── LIQUIDATION_COLLECTOR -> LiquidationCollector (SQLite)
   │      └── WebSockets continuos
   │
   ├── ORDERBOOK_COLLECTOR -> OrderBookCollector (SQLite)
   │      └── snapshots REST cada 1 minuto
   │
   └── BINANCE_REGION_PROBE -> diagnóstico aislado
```

## Símbolos

Por defecto:

- BTCUSDT
- ETHUSDT
- SOLUSDT
- BNBUSDT
- XRPUSDT
- DOGEUSDT
- ADAUSDT
- BCHUSDT

Se configuran con `COLLECTOR_SYMBOLS` en `wrangler.jsonc`.

---

## LiquidationCollector

### Fuentes activas

- **Bybit Linear**: `allLiquidation.{symbol}`.
- **Gate.io Futures USDT**: `futures.public_liquidates`; se usa `quanto_multiplier` para normalizar el nocional.
- **BitMEX**: tabla pública `liquidation`; en esta versión aporta XBTUSD/BTC.

### Binance

Binance está desactivado para recolección activa desde Cloudflare. El collector principal y probes en Western Europe, Asia-Pacific y Western North America devolvieron HTTP 403 tanto para REST como para WebSocket upgrade.

Se conserva el endpoint de diagnóstico, pero no se mantienen reintentos permanentes de Binance.

### Persistencia

Tabla lógica principal:

```text
liquidation_buckets
- exchange
- symbol
- bucket_ts
- long_usd
- short_usd
- events
```

Los eventos se acumulan en memoria y se vacían como buckets de **1 minuto**. No se escribe una fila SQLite por evento WebSocket.

### Retención

**72 horas** rodantes.

Una alarma elimina automáticamente buckets anteriores al límite.

La API expone ventanas de:

- 1 h
- 4 h
- 12 h
- 24 h

### Endpoints

```text
GET /bootstrap
GET /health
GET /v1/liquidations/symbols
GET /v1/liquidations/summary?symbol=BTCUSDT
GET /v1/diagnostics/binance
GET /v1/diagnostics/binance-regions
```

---

## OrderBookCollector

### Objetivo

Construir continuidad histórica para el heatmap de order book sin guardar cada delta de alta frecuencia.

El navegador mantiene el WebSocket en vivo y guarda muestras de 5 segundos en IndexedDB. Cloudflare toma una muestra central cada **1 minuto**.

### Fuentes centrales

- Bybit
- OKX
- MEXC
- WhiteBIT
- Bitunix

Cada fuente se consulta de forma pública y best-effort. Si una fuente falla en un minuto, las demás pueden seguir formando el snapshot.

### Fuentes sólo browser-side

- **Binance**: Cloudflare continúa bloqueado con HTTP 403.
- **BingX**: se mantiene browser-side en esta etapa; no se agregan secretos privados sólo para el histórico central.

### Persistencia

Tabla:

```text
orderbook_snapshots
- symbol
- bucket_ts
- payload_json
```

Hay **una fila por símbolo/minuto**. `payload_json` agrupa las fuentes que respondieron en ese snapshot.

No se crea una fila separada por exchange porque eso multiplicaría las escrituras. El JSON conserva la separación por fuente para reconstruir posteriormente `Todos` o un exchange individual cuando existe cobertura central.

Cada libro conserva hasta 30 niveles por lado/fuente, convertidos a:

```text
[precio, nocional_usd]
```

Para contratos donde la cantidad viene en contratos (por ejemplo OKX/MEXC), el collector usa los metadatos públicos del instrumento para convertir a cantidad base antes de calcular el nocional.

### Retención

**48 horas** rodantes.

No se conserva actualmente una capa de 7 días. El producto no usa esas temporalidades y la prioridad es mantener el uso de SQLite controlado.

### Resolución

```text
Cloudflare: 1 minuto
Browser IndexedDB: 5 segundos
```

El histórico central y el local se combinan en el frontend. El central aporta continuidad mientras la PC está cerrada; el local aporta detalle fino durante la sesión.

### Endpoints

```text
GET /v1/orderbook/health
GET /v1/orderbook/symbols
GET /v1/orderbook/history?symbol=BTCUSDT&exchange=all&hours=4
```

`hours` admite hasta 48 horas. La UI actual consulta hasta 4 horas para el heatmap.

### Health

`/v1/orderbook/health` informa:

- símbolos configurados;
- resolución;
- retención;
- fuentes centrales;
- fuentes browser-only;
- último ciclo de recolección;
- éxitos/fallos por fuente desde el último arranque del objeto;
- cantidad de filas y primer/último snapshot almacenado.

---

## Política de almacenamiento

La idea es que la base llegue a un estado estable en vez de crecer indefinidamente.

### Order book

Con 8 símbolos:

```text
8 × 1.440 minutos = ~11.520 filas nuevas/día
```

Con 48 h de retención, el estado estable ronda unas 23.040 filas, salvo huecos por fallos de fuente.

### Liquidaciones

Las filas dependen de la actividad: sólo hay bucket cuando hubo liquidaciones de una fuente/símbolo durante ese minuto.

### Borrado

- order book: `bucket_ts < now - 48h`;
- liquidaciones: `bucket_ts < now - 72h`.

Los `DELETE` también son parte del costo de escritura, por eso se evita persistir snapshots de 5 segundos en Cloudflare.

---

## Deploy con Cloudflare Git Integration

Configuración esperada:

- Production branch: `main`
- Root directory: `/`
- Build command: `cd apps/collector && npm install`
- Deploy command: `cd apps/collector && npx wrangler deploy`
- Version command: `cd apps/collector && npx wrangler versions upload`
- Build watch path: `apps/collector/**`
- Builds for non-production branches: desactivado
- Cloudflare Access: desactivado

Después de desplegar, verificar:

```text
https://<worker>.workers.dev/bootstrap
https://<worker>.workers.dev/health
https://<worker>.workers.dev/v1/orderbook/health
https://<worker>.workers.dev/v1/liquidations/symbols
https://<worker>.workers.dev/v1/orderbook/symbols
```

`/bootstrap` instancia/activa el collector de liquidaciones. El OrderBookCollector se instancia al consultar sus endpoints y su alarma mantiene luego la recolección periódica.

---

## Desarrollo local

```bash
npm install
npm run dev
```

Validación del bundle/configuración:

```bash
npm run check
```

## Reglas de contribución

- no importar módulos del frontend dentro del Worker;
- minimizar escrituras por evento;
- no guardar secretos en `wrangler.jsonc`;
- mantener endpoints de lectura sin efectos destructivos;
- no bajar el intervalo Cloudflare a 5 segundos sin recalcular primero el presupuesto de escrituras;
- documentar cualquier cambio de retención/resolución en este README y en el README raíz.
