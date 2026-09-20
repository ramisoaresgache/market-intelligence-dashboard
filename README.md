# Market Intelligence Dashboard

Dashboard privado y **read-only** de inteligencia de mercado para perpetuos crypto. Esta
implementación corresponde exclusivamente a la Fase 1 solicitada en la
[especificación MVP](docs/Market_Intelligence_Dashboard_Especificacion_MVP.md).

## Estado de la Fase 1

Implementado:

- monorepo con `apps/web` (Next.js + TypeScript) y `services/api` (FastAPI + asyncio);
- adapters independientes para Binance USD-M y Bybit linear;
- order books incrementales normalizados, con snapshots, aplicación de deltas y validación
  de continuidad;
- liquidaciones observadas: Binance `forceOrder` (`snapshot`, cobertura parcial) y Bybit
  `allLiquidation` (`all`);
- open interest de Binance y Bybit; ticker y funding de Bybit;
- reconexión WebSocket con backoff exponencial, jitter y estado por fuente;
- estado live y ring buffer de liquidaciones de 24 h exclusivamente en RAM;
- API REST interna y WebSocket backend → frontend;
- dashboard dark, desktop-first y responsive para BTC, ETH y SOL;
- degradación por fuente y timestamps visibles;
- Dockerfile de backend y configuración objetivo para Railway/Vercel.

Fuera de esta fase, deliberadamente: PostgreSQL, Redis/Upstash, CoinGlass, trading real,
BingX, Bitunix, noticias, macro, Liquidity Heatmap y Estimated Liquidation Heatmap.

## Arquitectura

```text
Binance USD-M ─┐
               ├─ adapters asyncio ─ normalización ─ StateManager (RAM)
Bybit V5 ──────┘                                  │
                                                  ├─ REST /api/*
                                                  └─ WS /ws/market
                                                           │
                                                    Next.js dashboard
```

La caída de un exchange no detiene al otro. No se mezclan instrumentos spot con perpetuos;
todos los libros de esta fase llevan `market_type: "perpetual"`.

## Requisitos locales

- Python 3.11+
- Node.js 20.9+
- npm 10+
- Docker opcional, solo para ejecutar el backend en contenedor

## Instalación

Desde la raíz del repositorio:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".\services\api[dev]"
npm install
```

En macOS/Linux, reemplazar el ejecutable Python por `.venv/bin/python`.

## Ejecución local

Terminal 1 — backend:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Terminal 2 — frontend:

```powershell
npm run dev:web
```

Abrir `http://localhost:3000`. La documentación OpenAPI del backend queda disponible en
`http://localhost:8000/docs`.

El frontend usa por defecto:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

Copiar `apps/web/.env.example` a `apps/web/.env.local` solo si se necesitan otros hosts.
Estas variables son públicas y no contienen secretos.

Para permitir el dominio desplegado en Vercel, configurar en Railway una lista separada por
comas. Localhost continúa habilitado cuando se lo incluye explícitamente:

```dotenv
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://market-dashboard.vercel.app
```

## API interna implementada

| Método | Ruta | Notas |
| --- | --- | --- |
| `GET` | `/api/health` | Estado global y por fuente |
| `GET` | `/api/symbols` | BTCUSDT, ETHUSDT y SOLUSDT |
| `GET` | `/api/market/{symbol}/snapshot` | Estado normalizado completo del símbolo |
| `GET` | `/api/orderbook/{symbol}?exchange=all&depth=50` | `all`, `binance` o `bybit`; profundidad 1–200 |
| `GET` | `/api/liquidations/{symbol}?window=1h` | Ventanas `15m`, `1h`, `4h` o `24h` |
| `WS` | `/ws/market?symbols=BTCUSDT,ETHUSDT,SOLUSDT` | Snapshot inicial y eventos live |

Eventos WebSocket emitidos en esta fase:

- `market.snapshot`
- `orderbook.update`
- `liquidation.event`
- `metrics.update`
- `source.status`

El backend procesa cada delta de los exchanges a frecuencia completa, pero coalesce el
libro enviado a navegadores por exchange/símbolo a intervalos de aproximadamente 200 ms.
Cada cliente tiene una cola acotada: si se llena o un envío supera el timeout, la conexión
se cierra con código `1013` para que el frontend reconecte y reciba snapshots frescos.

No se agregaron rutas para módulos pendientes.

## Fuentes oficiales

- Binance USD-M: [depth stream](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Diff-Book-Depth-Streams),
  [liquidation stream](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/All-Market-Liquidation-Order-Streams),
  [depth snapshot](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book)
  y [open interest](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest).
- Bybit V5: [conexión pública](https://bybit-exchange.github.io/docs/v5/ws/connect),
  [order book](https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook),
  [allLiquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation),
  [ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker) y
  [open interest](https://bybit-exchange.github.io/docs/v5/market/open-interest).

La UI etiqueta las liquidaciones como **Observed**. Binance solo publica la última
liquidación por símbolo dentro de cada ventana de 1000 ms, por lo que su calidad se marca
`snapshot`; Bybit `allLiquidation` se marca `all`.

## Calidad y pruebas

Backend:

```powershell
cd services/api
..\..\.venv\Scripts\python.exe -m pytest -p no:cacheprovider
..\..\.venv\Scripts\ruff.exe check app tests
..\..\.venv\Scripts\ruff.exe format --check app tests
..\..\.venv\Scripts\mypy.exe app
```

Frontend:

```powershell
npm run lint
npm run typecheck
npm run build:web
```

## Docker backend

```powershell
docker build -t market-intelligence-api services/api
docker run --rm -p 8000:8000 market-intelligence-api
```

El contenedor corre como usuario no root, escucha en `0.0.0.0` y usa `PORT` cuando Railway
lo proporciona, con `8000` como fallback local.

## Deploy objetivo

- `apps/web` → Vercel, configurando `NEXT_PUBLIC_API_URL` y `NEXT_PUBLIC_WS_URL` con las
  URLs públicas del backend.
- `services/api` → Railway mediante `services/api/Dockerfile`, como proceso persistente.

El histórico vive en memoria y se pierde al reiniciar. Redis/Upstash solo se evaluará si
aparece una necesidad concreta de multi-instancia o TTL compartido.
