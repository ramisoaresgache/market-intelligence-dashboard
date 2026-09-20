# Market Intelligence Dashboard

Plataforma pública y **solo lectura** de inteligencia de mercados crypto, desplegada en Vercel y diseñada para operar con coste de infraestructura inicial de **USD 0**.

La interfaz está orientada a español y busca centralizar información que normalmente obliga a abrir exchanges, CoinGlass, Investing y fuentes de noticias/macro por separado.

## Arquitectura actual

```text
Vercel / Next.js
      │
      ├── Browser Market Engine
      │     ├── Binance USD-M WS/REST
      │     └── Bybit Linear WS/REST
      │
      ├── Web Worker
      │     └── datos de alta frecuencia -> snapshot UI cada ~150 ms
      │
      └── IndexedDB
            └── historial local de liquidez
```

No hace falta Railway, Google Cloud, PostgreSQL, Redis ni un backend persistente.

## Mercados

El navegador consulta los instrumentos públicos de Binance y Bybit y construye dinámicamente el universo de **perpetuos USDT que están activos en ambos exchanges**. BTC, ETH, SOL, BNB, XRP y DOGE aparecen como accesos rápidos, pero el selector puede contener cientos de pares compatibles.

Para mantener el consumo razonable, sólo se abren streams pesados de order book para **el par seleccionado**. Al cambiar de moneda, el Web Worker cierra los streams anteriores y abre los del nuevo mercado.

Si la consulta del universo falla, existe una lista de respaldo con los principales pares.

## Módulos implementados

- precio de marca / último precio;
- mejor compra y mejor venta;
- open interest Binance y Bybit;
- funding de Bybit;
- liquidaciones observadas en vivo;
- order book de Binance y Bybit;
- **order book agregado**, con filtro Todos / Binance / Bybit;
- buckets de precio automáticos según el valor del activo;
- **Liquidity Heatmap** browser-side;
- historial local del heatmap en IndexedDB;
- ventanas de 30 min, 1 h, 2 h y 4 h;
- estado de conexión por fuente;
- UI responsive en español.

## Qué representa el mapa de liquidez

El **Liquidity Heatmap** representa órdenes limit visibles de los order books públicos. No representa liquidaciones futuras ni garantiza que una pared vaya a permanecer o ejecutarse.

El navegador toma una muestra aproximadamente cada 5 segundos, la agrega por price buckets y conserva hasta 4 horas en IndexedDB. Por lo tanto, el historial es local a cada navegador y empieza a construirse desde que el visitante usa la web.

## Liquidaciones observadas

- Bybit `allLiquidation`: se etiqueta como cobertura `all` según la documentación de la fuente.
- Binance `!forceOrder@arr`: se etiqueta como `snapshot`, ya que su cobertura es parcial.

No se presentan ambas fuentes como si tuvieran la misma completitud.

## Pendiente

Siguientes módulos previstos:

1. Estimated Liquidation Heatmap propio.
2. BingX y Bitunix si sus streams browser-side resultan compatibles.
3. Noticias relevantes.
4. FED / SEC.
5. Calendario macro.
6. Overview general de mercado.

## Desarrollo

```bash
npm install
npm run dev:web
```

Abrir `http://localhost:3000`.

Validaciones:

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```

No hay variables de entorno obligatorias para el market engine.

## Fuente de verdad

La especificación funcional/técnica vive en:

`docs/Market_Intelligence_Dashboard_Especificacion_MVP.md`

Regla conceptual fundamental:

- **Liquidity Heatmap** = órdenes limit visibles.
- **Observed Liquidations** = liquidaciones reportadas por exchanges.
- **Estimated Liquidation Heatmap** = modelo propio futuro de zonas potenciales, nunca dato exacto.
