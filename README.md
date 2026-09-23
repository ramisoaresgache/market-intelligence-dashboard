# Market Intelligence Dashboard

Plataforma pública y **solo lectura** de inteligencia de mercados crypto. El frontend corre en Vercel/Next.js y la recolección central 24/7 usa Cloudflare Workers + Durable Objects con SQLite.

El objetivo operativo actual es mantener la infraestructura en el tier gratuito siempre que el uso real y los límites vigentes de los proveedores lo permitan. El diseño prioriza agregación, retención corta y borrado automático para no guardar datos de alta frecuencia indefinidamente.

> Este README describe la arquitectura que debe quedar activa después de mergear el PR del heatmap de order book + histórico central. Es la referencia rápida para auditorías y para herramientas como Codex.

---

## 1. Arquitectura general

```text
EXCHANGES PÚBLICOS
      │
      ├─────────────────────────────────────────────────────┐
      │                                                     │
      ▼                                                     ▼
NAVEGADOR / VERCEL                                   CLOUDFLARE 24/7
      │                                                     │
      ├── Browser Market Engine                             ├── LiquidationCollector DO
      │     └── WebSockets en vivo                          │     ├── Bybit
      │                                                     │     ├── Gate.io
      ├── Web Worker                                        │     └── BitMEX
      │     └── snapshots UI ~150 ms                        │
      │                                                     ├── OrderBookCollector DO
      ├── IndexedDB                                         │     ├── Bybit
      │     ├── order book: muestra cada 5 s                │     ├── OKX
      │     └── liquidaciones: fallback local               │     ├── MEXC
      │                                                     │     ├── WhiteBIT
      └── API routes Next.js                                │     └── Bitunix
            ├── /api/liquidations                           │
            ├── /api/orderbook-history                      └── SQLite + alarmas
            └── /api/capital-flows
```

La regla principal es:

- **tiempo real**: se obtiene del WebSocket del exchange mientras la web está abierta;
- **histórico fino local**: se guarda en IndexedDB del navegador;
- **histórico central 24/7**: se guarda en Cloudflare con resolución más baja y retención limitada;
- **la base central no reemplaza al dato en vivo**: sirve para dar continuidad cuando el navegador estuvo cerrado.

---

## 2. Símbolos recolectados 24/7

El collector central arranca por defecto con estos perpetuos USDT:

- `BTCUSDT`
- `ETHUSDT`
- `SOLUSDT`
- `BNBUSDT`
- `XRPUSDT`
- `DOGEUSDT`
- `ADAUSDT`
- `BCHUSDT`

Se configuran en `apps/collector/wrangler.jsonc` mediante `COLLECTOR_SYMBOLS`.

Esto significa que las liquidaciones y el histórico central de order book de esos símbolos se empiezan a construir **aunque nadie abra la página**, una vez que los Durable Objects fueron inicializados con `/bootstrap` después del deploy.

Importante: no existe backfill mágico. Si mañana se agrega un símbolo nuevo a `COLLECTOR_SYMBOLS`, el histórico empieza desde ese momento hacia adelante salvo que incorporemos una fuente histórica específica.

---

## 3. Qué datos viven dónde

| Dato | Fuente/ejecución | Resolución | Retención | Persistencia |
|---|---|---:|---:|---|
| Precio / mark price / métricas | Browser WebSocket/REST | en vivo | no aplica | memoria del navegador |
| Order book actual | Browser WebSocket | cambios continuos | mientras la sesión está abierta | memoria del navegador |
| Heatmap order book local | Browser + IndexedDB | **5 s** | **4 h** | IndexedDB |
| Heatmap order book central | Cloudflare Durable Object | **1 min** | **48 h** | SQLite |
| Liquidaciones centrales | Cloudflare WebSockets | bucket **1 min** | **72 h** | SQLite |
| Liquidaciones locales | Browser + IndexedDB | evento a evento | **24 h** | IndexedDB, sólo fallback |
| ETF BTC/ETH/SOL | SoSoValue vía API server-side | diario | según proveedor | no se persiste localmente |
| BTC hacia/desde exchanges | Coin Metrics Community | diario | según proveedor | no se persiste localmente |

### Por qué hay dos históricos de order book

El WebSocket puede cambiar muchas veces por segundo. Guardar cada delta 24/7 en Cloudflare sería innecesariamente caro y ruidoso.

Por eso usamos dos capas:

```text
WebSocket continuo
      │
      ├── cada 5 s -> IndexedDB local -> detalle fino de la sesión
      │
      └── cada 1 min -> Cloudflare -> continuidad 24/7
```

Al abrir la página, el frontend combina:

1. snapshots centrales de Cloudflare;
2. snapshots locales de IndexedDB;
3. estado actual del libro recibido en vivo.

Así un refresh normal no destruye el historial local y cerrar la computadora tampoco deja completamente ciego al heatmap.

---

## 4. Order book y heatmap de liquidez

### 4.1 Fuentes en vivo del navegador

El market engine browser-side puede trabajar con:

- Binance
- Bybit
- OKX
- MEXC
- WhiteBIT
- BingX
- Bitunix

El selector del order book/heatmap permite `Todos` o una fuente individual cuando esa fuente entrega un libro válido.

### 4.2 Fuentes guardadas 24/7 en Cloudflare

El histórico central usa snapshots públicos REST de:

- Bybit
- OKX
- MEXC
- WhiteBIT
- Bitunix

Cada minuto se guarda **una sola fila por símbolo**, no una fila por exchange. Dentro de esa fila se conserva el snapshot compactado por fuente. Esto permite filtrar posteriormente por exchange sin multiplicar innecesariamente las escrituras SQLite.

#### Fuentes que no se guardan centralmente

- **Binance**: Cloudflare recibió HTTP 403 de Binance desde distintas regiones; se mantiene browser-side cuando el cliente puede acceder.
- **BingX**: permanece browser-side en esta etapa; no usamos credenciales privadas sólo para construir el histórico central.

Por lo tanto, `Todos` puede tener dos coberturas distintas:

- **ahora / sesión local**: hasta 7 exchanges;
- **histórico central**: hasta 5 exchanges.

La UI debe tratar esto como cobertura parcial, no como un equivalente exacto de CoinGlass.

### 4.3 Qué guarda un snapshot central

Por cada símbolo/minuto se guardan niveles normalizados de bids/asks por fuente con precio y nocional aproximado en USD.

No guardamos:

- cada mensaje WebSocket;
- cada delta individual;
- IDs de órdenes privadas;
- identidad de traders;
- órdenes históricas por más de 48 h.

### 4.4 Retención

El Durable Object elimina automáticamente snapshots de order book con más de **48 horas**.

No existe actualmente retención de 7 días porque no necesitamos mostrar esas temporalidades y sería almacenamiento sin utilidad para el producto actual.

### 4.5 Semántica

El heatmap de order book muestra **liquidez límite visible**. Una pared puede:

- permanecer;
- moverse;
- reducirse;
- cancelarse antes de ser ejecutada.

Por eso una zona intensa no es una promesa de soporte/resistencia ni una orden garantizada.

---

## 5. Liquidaciones observadas

### 5.1 Fuentes centrales

El collector 24/7 usa:

- **Bybit Linear**: `allLiquidation.{symbol}`;
- **Gate.io Futures USDT**: `futures.public_liquidates`;
- **BitMEX**: tabla pública `liquidation`; en la implementación actual BitMEX aporta BTC/XBTUSD.

Binance está desactivado dentro de Cloudflare por los 403 verificados. Se conserva sólo el diagnóstico.

### 5.2 Bucket de un minuto

No se escribe una fila por liquidación. Los eventos del minuto se acumulan en memoria y se persisten agrupados por:

```text
exchange
symbol
bucket_ts
long_usd
short_usd
events
```

Esto reduce drásticamente las escrituras frente a guardar cada evento individual.

### 5.3 Retención

La retención central de liquidaciones es de **72 horas**.

La UI muestra ventanas móviles de:

- 1 h
- 4 h
- 12 h
- 24 h

Guardar 72 h da margen operativo y de diagnóstico sin conservar una semana de datos que actualmente no mostramos.

Los buckets anteriores al límite se borran automáticamente mediante la alarma del Durable Object.

### 5.4 Por qué un símbolo tiene datos aunque nunca se haya abierto

Los ocho símbolos configurados se recolectan del lado de Cloudflare 24/7. Abrir `XRPUSDT` por primera vez en la web sólo **consulta** el histórico que ya existe; no inicia la recolección.

Si dos símbolos mostraran exactamente los mismos totales, eventos y desglose por exchange, eso sí sería una señal de bug y debería auditarse.

---

## 6. Diseño de almacenamiento y control de cuota

### Order book

Con ocho símbolos y una fila por minuto:

```text
8 símbolos × 1.440 minutos = 11.520 inserts/día aprox.
```

Con retención de 48 h, el estado estable ronda unas 23.040 filas de snapshots, antes de considerar huecos/fallos de fuente.

Cada fila contiene varias fuentes en un JSON compacto. Elegimos esto para evitar multiplicar las escrituras por 5-7 exchanges.

### Liquidaciones

Las liquidaciones se guardan sólo cuando existen eventos y se agregan por minuto/exchange/símbolo. El volumen real depende de la actividad del mercado.

### Limpieza

- order book: borrar `> 48 h`;
- liquidaciones: borrar `> 72 h`;
- IndexedDB order book: borrar `> 4 h`;
- IndexedDB liquidaciones: borrar `> 24 h`.

Las políticas son rodantes: el sistema agrega datos nuevos y elimina datos viejos continuamente. La intención es mantener el almacenamiento acotado en vez de dejar crecer una base sin límite.

Los límites de los planes gratuitos pueden cambiar. Para una auditoría real hay que comparar esta arquitectura con el panel de Usage de Cloudflare del momento, no asumir que una cuota histórica seguirá igual para siempre.

---

## 7. Endpoints principales

### Cloudflare collector

Arranque/health:

```text
GET /bootstrap
GET /health
GET /v1/orderbook/health
```

`/bootstrap` inicializa los collectors de liquidaciones y order book. Sus alarmas mantienen luego la recolección y limpieza periódicas.

Liquidaciones:

```text
GET /v1/liquidations/symbols
GET /v1/liquidations/summary?symbol=BTCUSDT
GET /v1/diagnostics/binance
GET /v1/diagnostics/binance-regions
```

Order book central:

```text
GET /v1/orderbook/symbols
GET /v1/orderbook/history?symbol=BTCUSDT&exchange=all&hours=4
```

`hours` puede consultar hasta 48 h, aunque la UI actual usa como máximo 4 h para el heatmap.

### Next.js / Vercel

```text
GET /api/liquidations?symbol=BTCUSDT
GET /api/orderbook-history?symbol=BTCUSDT&exchange=all&hours=4
GET /api/capital-flows
```

Las rutas Next actúan como proxy/control server-side para no acoplar la UI directamente a todos los proveedores.

---

## 8. Módulos de mercado actuales

- selector/buscador de perpetuos USDT;
- precio actual y movimiento 24 h;
- sesiones Asia / Europa / USA;
- order book agregado y por exchange;
- heatmap temporal de order book;
- mapa propio de liquidaciones estimadas;
- zoom del mapa de liquidaciones;
- totales de liquidaciones observadas 1h/4h/12h/24h;
- eventos recientes;
- BTC en exchanges / entradas y salidas on-chain;
- ETF spot BTC / ETH / SOL;
- calendario macro y noticias;
- captura PNG/Share Sheet de gráficos compatibles.

---

## 9. Diferencia entre los tres conceptos de liquidez/liquidación

No mezclar estas capas:

### Order Book / Liquidity Heatmap

Órdenes limit visibles actualmente o en snapshots históricos.

### Observed Liquidations

Eventos de liquidación que un exchange efectivamente reportó.

### Estimated Liquidation Heatmap

Modelo propio que estima zonas potenciales usando precio, open interest y escenarios de apalancamiento. No representa posiciones individuales publicadas por exchanges.

---

## 10. Variables de entorno y configuración

### Vercel

Opcionales/según módulo:

```text
LIQUIDATION_COLLECTOR_URL
SOSOVALUE_API_KEY
```

Si `LIQUIDATION_COLLECTOR_URL` no está definido, el proyecto usa el Worker público configurado como default en las API routes.

`SOSOVALUE_API_KEY` es server-side y no debe exponerse en variables `NEXT_PUBLIC_*`.

### Cloudflare

En `apps/collector/wrangler.jsonc`:

```text
COLLECTOR_SYMBOLS
CORS_ORIGIN
```

No guardar secretos en el repositorio.

---

## 11. Deploy

### Web

Vercel despliega `main`.

Importante: **Redeploy** en Vercel vuelve a construir el source code del deployment elegido. No significa necesariamente “usar el último main”. Para verificar una entrega, confirmar que el deployment de Production apunta al commit/merge más reciente.

### Collector

Cloudflare Workers Builds usa el monorepo y despliega cambios bajo `apps/collector/**`.

Configuración actual esperada:

```text
Production branch: main
Root directory: /
Build command: cd apps/collector && npm install
Deploy command: cd apps/collector && npx wrangler deploy
Version command: cd apps/collector && npx wrangler versions upload
```

Después de un deploy nuevo, abrir una vez:

```text
/bootstrap
```

para inicializar ambos Durable Objects y dejar sus alarmas programadas. Después verificar:

```text
/health
/v1/orderbook/health
/v1/liquidations/symbols
/v1/orderbook/symbols
```

---

## 12. Desarrollo y validaciones

Desde la raíz:

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build:web
```

Collector:

```bash
cd apps/collector
npm install
npm run check
```

---

## 13. Checklist de auditoría para Codex

Antes de modificar UI o arquitectura:

1. verificar el `main` actual y los últimos PR mergeados;
2. correr tests, lint, TypeScript y build;
3. no mover lógica del collector 24/7 al navegador;
4. no eliminar los fallbacks IndexedDB;
5. no convertir el sample de 5 s en escritura Cloudflare de 5 s;
6. mantener order book central a 1 min / 48 h salvo cambio explícito;
7. mantener liquidaciones centrales a 1 min / 72 h salvo cambio explícito;
8. preservar la separación conceptual entre order book, liquidaciones observadas y liquidaciones estimadas;
9. verificar que Binance Cloudflare siga desactivado mientras continúe devolviendo 403;
10. comprobar que una mejora visual no aumente el número de streams pesados abiertos simultáneamente;
11. revisar `/health` y `/v1/orderbook/health` después de cambios del collector;
12. nunca hardcodear API keys en el repo.

---

## 14. Archivos clave

```text
apps/web/app/page.tsx
apps/web/components/liquidity-heatmap.tsx
apps/web/components/liquidation-heatmap.tsx
apps/web/components/liquidation-summary.tsx
apps/web/lib/market/use-market-engine.ts
apps/web/lib/market/use-liquidity-history.ts
apps/web/lib/market/history-db.ts
apps/collector/src/index.ts
apps/collector/src/orderbook-history.ts
apps/collector/src/worker.ts
apps/collector/wrangler.jsonc
```

La especificación funcional/técnica original sigue en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`
