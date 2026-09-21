# Collector contribution notes

- Este directorio se despliega de forma independiente en Cloudflare Workers.
- No importar módulos del frontend `apps/web` dentro del Worker: mantener el bundle autónomo.
- El Durable Object usa SQLite embebido y debe minimizar escrituras por evento.
- Los WebSockets salientes deben recuperarse de cierres y reinicios mediante alarmas.
- No agregar secretos al repositorio ni a `wrangler.jsonc`; usar bindings/secrets de Cloudflare cuando sean necesarios.
- Mantener los endpoints de lectura idempotentes y sin efectos destructivos.
