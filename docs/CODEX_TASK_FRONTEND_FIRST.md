# Codex Task — PR 2: Browser Market Engine

Trabajar sobre la branch:

`feat/frontend-first-architecture`

Leer completamente antes de modificar código:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

Ese documento es la fuente de verdad.

## Objetivo

Migrar la obtención de datos live de Binance y Bybit desde el backend FastAPI a un motor browser-side en TypeScript, manteniendo el backend existente sólo como referencia temporal.

La web debe poder funcionar sin `NEXT_PUBLIC_API_URL`, sin `NEXT_PUBLIC_WS_URL` y sin un servidor persistente.

## Alcance exacto de este PR

Implementar únicamente:

1. Tipos normalizados TypeScript para:
   - OrderLevel
   - NormalizedOrderBook
   - LiquidationEvent
   - MarketMetrics
   - SourceStatus

2. `MarketConnectionManager` singleton por pestaña.

3. Adapter Binance browser-side:
   - USD-M perpetual
   - BTCUSDT / ETHUSDT / SOLUSDT
   - depth incremental
   - snapshot REST cuando corresponda
   - validación de secuencia
   - `!forceOrder@arr`
   - open interest REST
   - reconexión con backoff
   - source status

4. Adapter Bybit browser-side:
   - linear perpetual
   - `orderbook.50.{symbol}`
   - `allLiquidation.{symbol}`
   - `tickers.{symbol}`
   - open interest REST sólo si es necesario además del ticker
   - snapshot/delta validation
   - heartbeat
   - reconexión con backoff
   - source status

5. Web Worker / procesamiento desacoplado del render:
   - procesar datos de alta frecuencia fuera del render React;
   - coalescing hacia UI aproximadamente cada 100-250 ms;
   - no renderizar cada delta raw;
   - evitar duplicar conexiones entre componentes.

6. Migrar el dashboard actual para que consuma el Browser Market Engine.

7. La página debe mostrar al menos:
   - mark/last price
   - best bid/ask
   - spread
   - OI disponible
   - funding Bybit
   - observed liquidations live
   - source status Binance/Bybit
   - reconnecting/live state

8. Mantener correctamente:
   - Binance liquidations como `sourceQuality: snapshot` / cobertura parcial;
   - Bybit liquidations como `sourceQuality: all` según documentación de la fuente.

9. Tests unitarios equivalentes o superiores a los del backend actual para:
   - parsers;
   - depth deltas;
   - sequence gaps;
   - liquidation side mapping;
   - symbol mapping;
   - coalescing.

10. Prueba browser real:
   - verificar que Binance WebSocket funciona directamente desde navegador;
   - verificar que Bybit WebSocket funciona directamente desde navegador;
   - documentar cualquier restricción de Origin/CORS encontrada.

## No hacer en este PR

- no implementar Liquidity Heatmap;
- no implementar Estimated Liquidation Heatmap;
- no implementar IndexedDB todavía salvo infraestructura mínima estrictamente necesaria;
- no implementar noticias;
- no implementar macro;
- no agregar BingX;
- no agregar Bitunix;
- no eliminar `services/api`;
- no agregar PostgreSQL;
- no agregar Redis;
- no agregar hosting backend;
- no agregar CoinGlass;
- no agregar trading.

## Reglas técnicas

- Usar sólo endpoints/documentación oficial de Binance y Bybit.
- No inventar endpoints.
- UI nunca debe depender de payloads raw de exchanges.
- Una caída de Binance no debe tumbar Bybit y viceversa.
- Limpiar timers, workers y WebSockets al destruir el manager/pestaña.
- Evitar memory leaks y listeners duplicados en React Strict Mode.
- No guardar secretos en frontend.
- No usar librerías grandes si la funcionalidad se resuelve razonablemente con Web APIs nativas.

## Migración

El backend FastAPI actual contiene lógica útil de:

- parsers;
- sequence handling;
- liquidation mapping;
- reconnect;
- normalized models.

Portar esas ideas a TypeScript sin acoplar el frontend al backend.

No borrar el backend hasta un PR posterior.

## Criterios de aceptación

El PR puede considerarse terminado sólo si:

1. `npm run dev:web` funciona sin FastAPI levantado.
2. El dashboard recibe datos reales de Binance y Bybit directamente.
3. No necesita `NEXT_PUBLIC_API_URL` ni `NEXT_PUBLIC_WS_URL`.
4. BTC/ETH/SOL reciben actualizaciones live.
5. La UI no se actualiza a frecuencia raw de los exchanges.
6. La reconexión funciona.
7. Si una fuente falla, la otra continúa.
8. Los tests pasan.
9. ESLint pasa.
10. TypeScript pasa.
11. Production build pasa.
12. README queda actualizado con ejecución frontend-only.

## Entrega

Cuando termines:

- ejecutar tests;
- ejecutar lint;
- ejecutar typecheck;
- ejecutar build de producción;
- realizar smoke test browser real;
- corregir errores;
- subir cambios a `feat/frontend-first-architecture`;
- abrir PR contra `main`;
- informar commit SHA;
- resumir qué quedó implementado;
- informar explícitamente si Binance y Bybit funcionan browser-side sin backend.
