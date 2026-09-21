# Deploy checklist

1. Mergear PR del collector a `main`.
2. En Cloudflare Git Integration seleccionar el repo `ramisoaresgache/market-intelligence-dashboard`.
3. Project name: `market-intelligence-collector`.
4. Root directory: `apps/collector`.
5. Build command: vacío.
6. Deploy command: `npx wrangler deploy`.
7. Production branch: `main`.
8. Desactivar builds para branches no productivas.
9. Mantener Cloudflare Access apagado durante la validación inicial.
10. Ejecutar el primer deploy.
11. Abrir `/bootstrap` una vez.
12. Verificar `/health` y luego `/v1/liquidations/summary?symbol=BTCUSDT`.
