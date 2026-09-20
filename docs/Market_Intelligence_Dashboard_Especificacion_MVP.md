# Market Intelligence Dashboard — Especificación MVP v3

**Versión:** 3.0  
**Fecha:** 20/09/2026  
**Estado:** fuente de verdad del proyecto

## Objetivo

Plataforma pública, en español y de solo lectura para centralizar información de mercado crypto que normalmente está repartida entre exchanges, CoinGlass, Investing y fuentes macro/noticias.

La aplicación no maneja portfolios personales, cuentas de exchanges, API keys privadas ni trading real.

El MVP debe poder operar con coste de infraestructura inicial **USD 0**.

## Arquitectura vigente

```text
GitHub -> Vercel -> Next.js
                     |
                     +-- Browser Market Engine
                     |     +-- Binance USD-M WS/REST
                     |     +-- Bybit Linear WS/REST
                     |
                     +-- Web Worker
                     |     +-- order books
                     |     +-- liquidaciones
                     |     +-- métricas
                     |     +-- coalescing UI
                     |
                     +-- IndexedDB
                           +-- historial local de liquidez
```

No usar backend persistente para retransmitir datos públicos de exchanges.

FastAPI en `services/api` queda temporalmente como referencia histórica, pero la web no depende de él.

## Decisiones cerradas

- Frontend: Next.js + TypeScript.
- Deploy: Vercel.
- Idioma visible principal: español.
- Base de datos central: no.
- Redis: no.
- Backend 24/7: no.
- CoinGlass: no consumir ni scrapear.
- Trading real: fuera del MVP.
- Login/usuarios: fuera del MVP.
- Persistencia corta: IndexedDB local.
- Datos de mercado: conexiones públicas directas desde navegador siempre que sea viable.

## Mercados soportados

No limitar la plataforma a BTC/ETH/SOL.

Al iniciar, consultar:

- Binance USD-M `exchangeInfo`;
- Bybit V5 `instruments-info?category=linear`.

Construir el universo de **perpetuos USDT activos en ambos exchanges**, excluyendo instrumentos TradFi de Bybit cuando corresponda.

Priorizar visualmente:

- BTC
- ETH
- SOL
- BNB
- XRP
- DOGE

pero permitir seleccionar el resto del universo compatible.

### Regla de escalabilidad

No abrir order books de cientos de monedas simultáneamente.

El navegador mantiene streams de alta frecuencia únicamente para **el mercado seleccionado**. Al cambiar de símbolo:

1. cerrar streams anteriores;
2. limpiar estado live del símbolo anterior;
3. abrir Binance/Bybit para el nuevo símbolo;
4. restaurar historial local del nuevo símbolo desde IndexedDB;
5. continuar capturando muestras.

## Fuentes actuales

### Binance USD-M

- Depth WS: `wss://fstream.binance.com/public/ws/{symbol}@depth@100ms`
- Snapshot depth REST: `/fapi/v1/depth`
- Liquidaciones: `wss://fstream.binance.com/market/ws/!forceOrder@arr`
- Open Interest REST: `/fapi/v1/openInterest`
- Exchange info: `/fapi/v1/exchangeInfo`

Las liquidaciones Binance deben marcarse como cobertura parcial / `snapshot`.

### Bybit Linear

- WS: `wss://stream.bybit.com/v5/public/linear`
- Order book: `orderbook.50.{symbol}`
- Liquidaciones: `allLiquidation.{symbol}`
- Ticker: `tickers.{symbol}`
- Instrumentos: `/v5/market/instruments-info?category=linear`

Las liquidaciones Bybit se marcan como `all` según documentación de la fuente.

## Browser Market Engine

- Un solo `MarketConnectionManager` por pestaña.
- Un Web Worker procesa mensajes de alta frecuencia.
- React recibe snapshots coalescidos aproximadamente cada 150 ms.
- Una caída de Binance no debe detener Bybit y viceversa.
- Validar secuencias de depth incremental.
- La UI nunca consume payloads raw de exchange.

## Order Book agregado

Para el símbolo activo:

1. normalizar niveles Binance + Bybit;
2. calcular `notional = price * qty`;
3. agrupar niveles en price buckets automáticos;
4. sumar nocional por bucket;
5. conservar desglose por exchange;
6. permitir filtros `Todos`, `Binance`, `Bybit`;
7. mostrar compras y ventas separadas.

El bucket automático debe adaptarse al precio para funcionar tanto con BTC como con altcoins de bajo precio.

## Liquidity Heatmap

Representa **órdenes limit visibles**, no liquidaciones.

Construcción:

- snapshot agregado cada ~5 segundos;
- X = tiempo;
- Y = precio;
- intensidad = nocional visible usando escala logarítmica;
- diferenciar bids y asks;
- mostrar línea de precio actual;
- ventanas iniciales: 30 min, 1 h, 2 h, 4 h.

### IndexedDB

Guardar frames de liquidez por `symbol + timestamp`.

Retención inicial: 4 horas.

Cada navegador tiene su propio histórico. No existe histórico global compartido.

Limpiar registros vencidos automáticamente.

## Observed Liquidations

Mostrar:

- hora;
- exchange/fuente;
- largo/corto liquidado;
- precio;
- nocional;
- totales de sesión.

Diferenciar explícitamente cobertura Binance vs Bybit.

## UI

Todo texto funcional debe estar en español, salvo nombres propios/técnicos como Binance, Bybit, Bitcoin, funding cuando se use como término de mercado acompañado por explicación.

Pantalla actual:

1. estado de fuentes;
2. selector dinámico de mercado;
3. accesos rápidos;
4. precio y métricas;
5. Liquidity Heatmap;
6. Order Book agregado;
7. liquidaciones observadas;
8. feed de últimos eventos.

Responsive para desktop y móvil.

## Próxima fase: Estimated Liquidation Heatmap

Debe estar visual y conceptualmente separado del Liquidity Heatmap.

Será un modelo propio basado inicialmente en:

- mark price;
- open interest y delta OI;
- funding;
- volatilidad;
- liquidaciones observadas;
- trades/taker imbalance cuando se agreguen;
- canasta estimada de apalancamiento.

Nunca presentarlo como niveles exactos de liquidación.

## Fases posteriores

### Exchanges

Evaluar browser-side:

- BingX;
- Bitunix.

Sólo agregarlos si sus APIs/WS públicos funcionan correctamente desde navegador sin infraestructura paga.

### Noticias y macro

Usar Route Handlers serverless de Next/Vercel para fuentes puntuales que necesiten RSS/XML/cache/CORS.

Fuentes prioritarias:

- Federal Reserve / FOMC;
- SEC;
- BLS;
- BEA;
- GDELT como agregador complementario.

Objetivo: noticias de alto impacto, calendario económico y contexto que pueda mover BTC/mercados.

No hacer polling agresivo.

## Conceptos que nunca deben confundirse

1. **Liquidity Heatmap** = órdenes limit visibles reales.
2. **Observed Liquidations** = eventos de liquidación reportados por exchanges.
3. **Estimated Liquidation Heatmap** = modelo estimado propio de zonas potenciales.

## Validación obligatoria por PR

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```

Además, para cambios de feeds:

- smoke test real en navegador;
- comprobar Binance y Bybit con backend apagado;
- cambiar entre varios símbolos;
- verificar que no quedan WebSockets duplicados;
- comprobar recuperación/reconexión;
- comprobar que IndexedDB no rompe navegación privada o navegadores donde falle almacenamiento.
