# Deploy del collector en Cloudflare

Configuración esperada en Workers Builds:

```text
Production branch: main
Root directory: /
Build command: cd apps/collector && npm install
Deploy command: cd apps/collector && npx wrangler deploy
Version command: cd apps/collector && npx wrangler versions upload
Build watch path: apps/collector/**
```

Después de cada deploy que modifique el collector:

1. Abrir `https://<worker>.workers.dev/bootstrap` una vez. Esto instancia y activa `LiquidationCollector` y `OrderBookCollector`.
2. Verificar `GET /health`.
3. Verificar `GET /v1/orderbook/health`.
4. Verificar `GET /v1/liquidations/symbols`.
5. Verificar `GET /v1/orderbook/symbols`.

Se espera actualmente:

```text
Liquidaciones: bucket 1 min, retención 72 h.
Order book: snapshot 1 min, retención 48 h.
Símbolos: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, BCH contra USDT.
```

Si `/v1/orderbook/health` muestra errores parciales por fuente, revisar `sources` antes de asumir que el Durable Object falló completo: el snapshot es best-effort y puede persistir las fuentes que sí respondieron.
