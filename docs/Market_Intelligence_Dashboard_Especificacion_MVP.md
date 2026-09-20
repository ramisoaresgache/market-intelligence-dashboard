# Market Intelligence Dashboard — Especificación MVP v2

**Versión:** 2.0  
**Fecha:** 20/09/2026  
**Estado:** fuente de verdad del proyecto  
**Objetivo:** plataforma pública de inteligencia de mercados, gratuita de operar en su MVP, que centralice datos crypto en tiempo real, liquidaciones, liquidez, derivados, noticias y eventos macro sin depender de CoinGlass, Investing ni de un backend persistente 24/7.

## 1. Visión del producto

La aplicación será pública y podrá ser utilizada por cualquier visitante sin login.

No es una aplicación de portfolio personal. No se guardan balances, operaciones privadas, cuentas de exchanges, API keys de usuarios ni información personal de amigos/usuarios.

El objetivo es concentrar en una sola interfaz información que normalmente obliga a visitar varias fuentes:

- order books de exchanges;
- liquidaciones observadas;
- liquidity heatmap;
- estimated liquidation heatmap propio;
- open interest y funding;
- noticias relevantes para mercados;
- comunicados FED/SEC y eventos macro;
- overview de mercado.

Todo el MVP debe poder funcionar con coste de infraestructura **USD 0**, usando Vercel Hobby y fuentes públicas/gratuitas.

---

## 2. Decisiones cerradas

- Frontend: **Next.js + TypeScript**.
- Deploy: **Vercel**.
- Backend persistente: **NO** en el MVP v2.
- FastAPI actual: se conserva temporalmente como referencia durante la migración y luego puede eliminarse si deja de aportar valor.
- Base de datos: **NO**.
- Redis: **NO**.
- PostgreSQL: **NO**.
- CoinGlass: **NO consumir, scrapear ni requerir**.
- Trading real: **fuera del MVP**.
- Usuarios/login: **fuera del MVP**.
- Persistencia local opcional: **IndexedDB** en el navegador.
- Fuentes privadas o con credenciales personales: **fuera del MVP**.
- La web debe ser usable por visitantes anónimos.

Diferenciar siempre estos conceptos en UI y código:

1. **Liquidity Heatmap**: liquidez visible del order book.
2. **Observed Liquidations**: liquidaciones reportadas por exchanges.
3. **Estimated Liquidation Heatmap**: estimación propia de zonas potenciales de liquidación. Nunca dato exacto.

---

## 3. Arquitectura frontend-first

```text
                         VERCEL

              ┌─────────────────────────┐
              │       Next.js Web       │
              │                         │
              │ UI + Browser Engine     │
              │ Web Workers             │
              │ IndexedDB opcional      │
              └────────────┬────────────┘
                           │
          ┌────────────────┼──────────────────┐
          │                │                  │
          ▼                ▼                  ▼
  Exchange WebSockets   Route Handlers     Browser storage
  públicos directos     Serverless         IndexedDB
          │                │
  ┌───────┼───────┐       ├── FED RSS / pages
  │       │       │       ├── SEC RSS / releases
Binance  Bybit  futuros    ├── GDELT
                  adapters ├── BLS / BEA públicos
                            └── otras fuentes sin secreto
```

### Principio principal

Los streams públicos de mercado deben conectarse **directamente desde el navegador al exchange** cuando técnicamente sea posible.

No debe existir un servidor nuestro retransmitiendo continuamente order books o liquidaciones.

Cada navegador:

1. abre sus conexiones WS;
2. normaliza mensajes;
3. mantiene estado actual;
4. calcula agregados;
5. genera heatmaps;
6. persiste historial corto localmente si el usuario lo permite.

### Route Handlers de Vercel

Se permiten funciones serverless de Next.js para datos que:

- no admitan CORS desde navegador;
- necesiten normalización RSS/XML;
- convenga cachear en edge;
- requieran ocultar una API key futura;
- sean requests puntuales y no conexiones 24/7.

No utilizar Route Handlers como proxy continuo de WebSockets de exchanges.

---

## 4. Alcance del MVP v2

### Activos iniciales

- BTCUSDT
- ETHUSDT
- SOLUSDT

### Exchanges prioritarios

#### Fase A

- Binance USD-M
- Bybit Linear

#### Fase B

- BingX Perpetual
- Bitunix Futures

BingX/Bitunix se agregan únicamente después de verificar que sus WebSockets públicos funcionan correctamente desde navegador. Si una fuente bloquea `Origin` o presenta incompatibilidades browser-side, el módulo debe degradar de manera visible y documentar la limitación. No crear infraestructura paga para resolverlo.

---

## 5. Datos de mercado directos desde navegador

### Binance USD-M

Fuentes conocidas del proyecto:

- Depth WS: `wss://fstream.binance.com/public/ws/{symbol}@depth@100ms`
- Liquidations: `wss://fstream.binance.com/market/ws/!forceOrder@arr`
- Open Interest REST: `https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`

Reglas:

- Binance `forceOrder` se considera **Observed / partial snapshot**.
- No presentar ese stream como totalidad de las liquidaciones del exchange.
- Mantener validación de secuencia del depth incremental.

### Bybit V5

- WS público: `wss://stream.bybit.com/v5/public/linear`
- Orderbook: `orderbook.50.BTCUSDT`
- Liquidations: `allLiquidation.BTCUSDT`
- Ticker: `tickers.BTCUSDT`
- OI REST: `/v5/market/open-interest`

Reglas:

- Bybit `allLiquidation` se etiqueta como **Observed / all according to source documentation**.
- Heartbeat explícito.
- Validar snapshots/deltas/sequence.

### BingX Perpetual

Referencia existente:

- WS: `wss://open-api-swap.bingx.com/swap-market`
- Depth: `BTC-USDT@depth20@200ms`
- Incremental depth: `BTC-USDT@incrDepth`
- OI: `/openApi/swap/v2/quote/openInterest`
- Funding/mark: `/openApi/swap/v2/quote/premiumIndex`

Sus mensajes pueden requerir GZIP. Implementar sólo luego de prueba browser real.

### Bitunix Futures

Referencia existente:

- WS: `wss://fapi.bitunix.com/public/`
- depth: `depth_books`
- trades: `trade`
- price/funding: `price`
- REST depth: `/api/v1/futures/market/depth`

Implementar sólo luego de prueba browser real.

---

## 6. Browser Market Engine

Crear una capa independiente de React que procese datos de mercado.

Estructura objetivo sugerida:

```text
apps/web/
  lib/
    market/
      adapters/
        base.ts
        binance.ts
        bybit.ts
        bingx.ts
        bitunix.ts
      engine/
        orderbook.ts
        liquidations.ts
        liquidity-heatmap.ts
        estimated-liquidations.ts
        metrics.ts
      storage/
        indexeddb.ts
      types.ts
      symbols.ts
  workers/
    market.worker.ts
```

Preferir un **Web Worker** para procesamiento de alta frecuencia y evitar renders continuos del main thread.

El worker recibe mensajes raw/normalizados y publica hacia React snapshots/coalesced updates a una frecuencia razonable, objetivo inicial 4-10 actualizaciones UI por segundo.

Los WebSockets pueden vivir en el worker si la compatibilidad del navegador lo permite. Si no, las conexiones pueden vivir en un manager del main thread y enviar datos al worker.

---

## 7. Tipos normalizados TypeScript

```ts
export type Exchange = "binance" | "bybit" | "bingx" | "bitunix";

export interface OrderLevel {
  price: number;
  qty: number;
  notional: number;
}

export interface NormalizedOrderBook {
  exchange: Exchange;
  symbol: string;
  ts: number;
  bids: OrderLevel[];
  asks: OrderLevel[];
  sequence?: string | number | null;
}

export interface LiquidationEvent {
  exchange: Exchange;
  symbol: string;
  ts: number;
  side: "long" | "short";
  price: number;
  qty: number;
  notional: number;
  sourceQuality: "all" | "snapshot" | "unknown";
}

export interface MarketMetrics {
  exchange: Exchange;
  symbol: string;
  ts: number;
  markPrice?: number;
  lastPrice?: number;
  openInterest?: number;
  openInterestValue?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}
```

React/UI nunca debe depender del payload raw específico de un exchange.

---

## 8. Order Book agregado

Objetivo: visualizar liquidez conjunta de múltiples exchanges.

Proceso:

1. normalizar símbolos;
2. calcular `notional = price * qty`;
3. agrupar niveles por buckets de precio configurables;
4. sumar bids y asks;
5. conservar desglose por exchange;
6. permitir filtros por exchange;
7. indicar siempre que son mercados perpetual cuando corresponda.

Opciones de UI:

- All Exchanges
- Binance
- Bybit
- BingX
- Bitunix

No sumar silenciosamente instrumentos con unidades o tipos incompatibles.

---

## 9. Liquidity Heatmap

Este mapa representa **órdenes limit visibles**, no liquidaciones.

### Construcción browser-side

- capturar snapshots agregados cada 2-5 segundos;
- mantener historial en memoria;
- guardar opcionalmente en IndexedDB;
- retención local objetivo inicial: 6 horas;
- matriz:
  - X = tiempo;
  - Y = precio;
  - valor = notional visible;
- normalizar intensidad con `log1p()` o percentiles;
- poder distinguir bids/asks;
- opcional: persistencia de pared para diferenciar órdenes fugaces de liquidez estable.

### Persistencia

Si el navegador se abre por primera vez, el heatmap empieza sin histórico previo.

UI debe informar por ejemplo:

`Local history since 18:42`

IndexedDB puede conservar historial entre sesiones del mismo navegador.

No existe histórico global compartido en MVP.

---

## 10. Observed Liquidations

Mostrar feed live:

```text
17:31:42  BTC  LONG   $382K   Bybit
17:31:40  ETH  SHORT  $118K   Binance
```

Agregar localmente por:

- 15 minutos;
- 1 hora;
- 4 horas;
- sesión actual.

Mostrar:

- total long liquidado;
- total short liquidado;
- exchange;
- símbolo;
- cantidad de eventos;
- calidad de fuente.

No mezclar cobertura parcial de Binance con cobertura completa declarada de Bybit sin indicarlo.

---

## 11. Estimated Liquidation Heatmap v1

Este es un modelo analítico propio y debe etiquetarse explícitamente:

**Estimated Liquidation Heatmap**

Nunca decir que representa liquidaciones exactas abiertas en los exchanges.

### Inputs

- mark price;
- open interest;
- delta OI observado durante la sesión/local history;
- funding;
- trades/taker imbalance cuando esté disponible;
- liquidaciones observadas;
- volatilidad reciente;
- opcional long/short ratio si existe fuente gratuita confiable.

### Modelo inicial

1. observar cambios positivos de OI;
2. asociarlos a la zona de precio de ese intervalo;
3. estimar sesgo long/short con inputs disponibles;
4. distribuir exposure por una canasta configurable de leverage:
   - 3x
   - 5x
   - 10x
   - 20x
   - 50x
   - 100x
5. estimar niveles potenciales:
   - `longLiq ≈ entry * (1 - 1/L + adjustment)`
   - `shortLiq ≈ entry * (1 + 1/L - adjustment)`
6. acumular densidad por price bucket;
7. aplicar decay temporal;
8. validar visualmente contra liquidaciones observadas durante la sesión.

No inventar precisión falsa. Mostrar un indicador de que el mapa es estimado/modelado.

---

## 12. IndexedDB

IndexedDB es la persistencia local del MVP.

Guardar únicamente información pública derivada de mercado:

- liquidity snapshots;
- liquidation events recientes;
- OI samples;
- funding samples;
- preferencias UI no sensibles.

Retención recomendada:

- liquidity snapshots: 6 h;
- liquidations: 24 h;
- OI/funding: 24 h;
- preferencias: sin expiración necesaria.

Agregar límites de registros/tamaño y limpieza automática.

No almacenar credenciales, wallets, operaciones privadas ni datos personales.

---

## 13. Noticias y macro vía Vercel Functions

Las noticias no requieren un worker 24/7.

Crear Route Handlers serverless, por ejemplo:

```text
GET /api/news
GET /api/news/fed
GET /api/news/sec
GET /api/macro
```

Estas rutas consultan fuentes públicas cuando son invocadas y usan cache HTTP/edge.

### Fuentes prioritarias

#### Federal Reserve

- FOMC calendar: `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`
- feeds oficiales: `https://www.federalreserve.gov/feeds/feeds.htm`

Incluir principalmente:

- FOMC statements;
- discursos relevantes;
- testimonios;
- press releases;
- decisiones de tasas.

#### SEC

- press releases / newsroom oficial;
- priorizar crypto, ETFs, exchanges, enforcement y regulation cuando impacte mercado.

#### BLS / BEA

Utilizar fuentes públicas oficiales para:

- CPI;
- empleo/NFP;
- desempleo;
- PPI;
- GDP;
- PCE cuando corresponda por fuente.

No scrapear Investing.com para el MVP.

#### GDELT

Usar como agregador complementario para noticias globales:

- Bitcoin;
- Ethereum;
- Federal Reserve;
- Powell;
- inflation;
- SEC crypto;
- Bitcoin ETF;
- Nasdaq;
- oil;
- tariffs;
- sanctions;
- exchange hacks;
- geopolitical shocks.

GDELT no debe presentarse como feed tick-by-tick. Su frecuencia puede ser inferior a una fuente financiera premium.

### Frecuencia frontend

- refresh news: 60-180 s;
- refresh macro: 5-15 min salvo eventos cercanos;
- FED/SEC: 60-120 s durante uso activo.

No implementar polling agresivo que consuma límites serverless sin beneficio.

### Cache

Los Route Handlers deben enviar headers adecuados, por ejemplo usando `s-maxage`/`stale-while-revalidate` o mecanismos equivalentes de Next/Vercel.

---

## 14. Clasificación de noticias v1

No requerir IA paga.

Implementar reglas transparentes para categorizar:

### HIGH

- FOMC rate decision / statement;
- Powell / Fed policy speech relevante;
- CPI / PCE / NFP / unemployment surprise;
- ETF approval/rejection importante;
- SEC action material sobre grandes participantes crypto;
- exchange hack grande;
- sanciones/guerra/eventos geopolíticos con impacto claro en mercados;
- decisiones regulatorias mayores.

### MEDIUM

- ETF flows;
- regulación propuesta;
- earnings macro-relevantes;
- grandes adquisiciones;
- cambios materiales en exchanges.

### LOW

- contenido general de mercado;
- opinión sin evento factual;
- noticias repetidas.

La UI debe mostrar fuente, timestamp y enlace original.

---

## 15. Páginas/módulos frontend

### Dashboard

Resumen de:

- BTC / ETH / SOL;
- mark price;
- funding;
- OI;
- liquidaciones recientes;
- principales zonas de liquidez;
- high impact news;
- próximos eventos macro.

### Liquidations

- feed live;
- long vs short;
- por exchange;
- por símbolo;
- ventanas temporales locales.

### Liquidity Heatmap

- mapa order book histórico local;
- filtros por exchange;
- selección símbolo;
- escala de intensidad;
- tiempo de historial disponible.

### Estimated Liquidation Heatmap

- modelo propio;
- controles básicos;
- explicación breve de metodología;
- etiqueta Estimated siempre visible.

### Order Book

- agregado;
- individual por exchange;
- best bid/ask;
- spread;
- grandes walls;
- buckets configurables.

### News & Macro

- HIGH/MEDIUM/LOW;
- fuentes;
- timestamps;
- filtros crypto/macro/FED/SEC/geopolitics;
- próximos eventos económicos.

---

## 16. UX

- dark mode por defecto;
- desktop-first pero responsive;
- información densa y legible;
- evitar animaciones costosas con cada tick;
- status de conexión por exchange;
- reconexión automática;
- indicar fuente y freshness de cada módulo;
- mostrar degradación parcial sin romper toda la página;
- evitar lenguaje que sugiera datos exactos cuando son estimaciones.

---

## 17. Rendimiento

El navegador no debe renderizar cada delta de exchange.

Objetivo:

- consumir streams a frecuencia nativa;
- procesar en worker;
- publicar snapshots UI coalescidos cada ~100-250 ms;
- heatmap snapshots cada 2-5 s;
- limitar depth almacenado al necesario;
- limpiar buffers antiguos;
- evitar duplicar conexiones por componente React.

Debe existir **un único MarketConnectionManager** por pestaña.

---

## 18. Seguridad

- no incluir API keys privadas en código cliente;
- no incluir secretos en Git;
- Route Handlers pueden usar variables de entorno de Vercel si una fuente futura requiere key;
- sólo consumir datos públicos en browser;
- sanitizar contenido externo renderizado;
- no ejecutar HTML de feeds/noticias;
- no usar credenciales de exchange en el MVP.

---

## 19. Compatibilidad y degradación

Cada adapter debe reportar:

```ts
interface SourceStatus {
  exchange: string;
  connected: boolean;
  lastMessageAt?: number;
  detail?: string;
}
```

Si Binance funciona y Bybit falla, Binance debe seguir funcionando.

Si un exchange no permite conexión directa browser-side:

1. marcarlo unavailable;
2. mostrar causa resumida;
3. no bloquear el resto de la aplicación;
4. no crear un backend pago para ocultar el problema.

---

## 20. Tests mínimos

### Unitarios

- symbol mapping;
- parser Binance;
- parser Bybit;
- depth snapshot/deltas;
- sequence gap handling;
- liquidation side mapping;
- aggregated order book;
- price buckets;
- heatmap aggregation;
- retention IndexedDB/helpers;
- news impact classifier.

### Browser/integration

- conexión real a Binance desde navegador;
- conexión real a Bybit desde navegador;
- reconexión;
- worker lifecycle;
- UI no renderiza a frecuencia raw;
- IndexedDB restore/cleanup;
- Route Handlers de news con mocks.

No hacer tests que dependan permanentemente de disponibilidad externa para pasar CI.

---

## 21. Deploy

```text
GitHub
   |
   v
Vercel
   |
   ├── Next.js UI
   ├── Browser Market Engine
   ├── Web Workers
   └── Serverless Route Handlers (news/macro)
```

No Railway.
No Google Cloud VM.
No servidor always-on.
No base de datos.

Coste objetivo inicial: **USD 0**.

---

## 22. Migración desde MVP v1 existente

Actualmente existe un backend FastAPI funcional con Binance/Bybit.

La migración NO debe tirar conocimiento útil.

Reutilizar conceptualmente:

- normalización;
- symbol mapper;
- sequence validation;
- liquidation mapping;
- reconnection strategy;
- tests/parsers cuando puedan portarse a TypeScript.

### Estrategia

1. implementar adapters TypeScript browser-side para Binance y Bybit;
2. comprobar conexiones reales desde navegador;
3. crear MarketConnectionManager/worker;
4. migrar dashboard para depender del Browser Market Engine;
5. comprobar paridad funcional con MVP v1;
6. recién entonces eliminar dependencia de `NEXT_PUBLIC_API_URL` y `NEXT_PUBLIC_WS_URL`;
7. mantener `services/api` durante la migración;
8. eliminar `services/api` en un PR posterior únicamente cuando el frontend ya no dependa de él y los tests browser-side sean suficientes.

No eliminar FastAPI al inicio del refactor.

---

## 23. Orden de implementación MVP v2

### PR 2 — Browser market engine

1. tipos normalizados TypeScript;
2. Binance adapter browser-side;
3. Bybit adapter browser-side;
4. MarketConnectionManager;
5. Web Worker/coalescing;
6. reconnect/status;
7. dashboard usa datos directos;
8. tests.

### PR 3 — Order book + liquidity heatmap

1. aggregated order book;
2. filters;
3. snapshots históricos;
4. IndexedDB;
5. liquidity heatmap.

### PR 4 — Observed + estimated liquidations

1. feed live mejorado;
2. agregaciones temporales;
3. OI samples;
4. estimated liquidation model v1;
5. heatmap estimado.

### PR 5 — News & Macro

1. Vercel Route Handlers;
2. FED;
3. SEC;
4. GDELT;
5. BLS/BEA donde sea viable sin coste;
6. classifier;
7. News & Macro UI.

### PR 6 — Exchanges adicionales

1. BingX browser compatibility test;
2. adapter si es viable;
3. Bitunix browser compatibility test;
4. adapter si es viable.

---

## 24. Reglas para Codex

- Este documento es la **fuente de verdad**.
- No volver a introducir backend persistente.
- No agregar PostgreSQL/Redis.
- No consumir CoinGlass.
- No implementar trading real.
- No guardar información personal.
- No inventar endpoints de exchanges.
- Usar documentación oficial de cada fuente.
- Verificar browser compatibility antes de declarar un exchange soportado.
- No bloquear toda la app por una fuente caída.
- No presentar Estimated Liquidation Heatmap como datos exactos.
- Mantener scope de cada PR acotado.
- Ejecutar tests, lint, typecheck y production build antes de terminar.
