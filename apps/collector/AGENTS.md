# Collector contribution notes

- Este directorio se despliega de forma independiente en Cloudflare Workers.
- No importar módulos del frontend `apps/web` dentro del Worker: mantener el bundle autónomo.
- El Durable Object usa SQLite embebido y debe minimizar escrituras por evento.
- Los WebSockets salientes deben recuperarse de cierres y reinicios mediante alarmas.
- No agregar secretos al repositorio ni a `wrangler.jsonc`; usar bindings/secrets de Cloudflare cuando sean necesarios.
- Mantener los endpoints de lectura idempotentes y sin efectos destructivos.
- Política actual de liquidaciones: buckets de 1 minuto, retención central de 72 horas.
- Política actual de order book: snapshots centrales de 1 minuto, retención de 48 horas, una fila por símbolo/minuto con fuentes agrupadas.
- No bajar el snapshot central de order book a 5 segundos: el detalle de 5 segundos pertenece al IndexedDB browser-side.
- Si se cambia resolución, retención, símbolos o fuentes, actualizar también `apps/collector/README.md` y el `README.md` raíz.
