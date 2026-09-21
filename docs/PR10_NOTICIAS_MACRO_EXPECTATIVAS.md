# PR #10 — Noticias, Macro y Expectativas

## Objetivo

Agregar una segunda vista al Market Intelligence Dashboard para centralizar calendario macroeconómico, expectativas, escenarios y noticias de impacto sin incorporar base de datos central, backend persistente ni APIs pagas.

Ruta visible: `/macro`.

## Fuentes

### Calendario oficial

- **BLS**: calendario iCalendar oficial para CPI, Core CPI, Employment Situation, NFP y desempleo.
- **BEA**: JSON público de fechas de publicación para GDP y Personal Income and Outlays (PCE / Core PCE).
- **Federal Reserve**: calendario FOMC publicado oficialmente. Las fechas 2026-2027 se mantienen como semillas verificadas en el Route Handler para evitar scraping frágil en cada request.

### Expectativas y dato real

- **Forex Factory**: export semanal público usado exclusivamente como capa complementaria de `previous`, `forecast` y `actual`, además de eventos de Powell publicados en el calendario.
- Las fechas oficiales de BLS/BEA/FED tienen prioridad. Forex Factory no reemplaza la fuente oficial cuando existe una fecha verificada.

### Noticias

- **Federal Reserve RSS**: monetary policy, speeches y feed específico de Jerome Powell.
- **GDELT DOC API**: agregador complementario para noticias de mercado, macro, regulación y crypto.

## Arquitectura

```text
Browser
  |
  +-- /macro
  |     +-- /api/macro
  |     |     +-- BLS ICS
  |     |     +-- BEA JSON
  |     |     +-- FOMC oficial
  |     |     +-- Forex Factory semanal
  |     |
  |     +-- /api/news
  |           +-- Federal Reserve RSS
  |           +-- GDELT
  |
  +-- sin base de datos central
  +-- sin API keys obligatorias
```

Los Route Handlers usan cache de Vercel/Next para evitar polling agresivo:

- macro: 60 s, con `stale-while-revalidate`;
- noticias: 5 min, con `stale-while-revalidate`.

Cada fuente se consulta de forma independiente. Si una falla, la UI marca esa fuente como degradada y conserva los otros módulos operativos.

## Escenarios

Para eventos numéricos se calcula una sorpresa contra consenso:

- menor a lo esperado;
- en línea;
- mayor a lo esperado.

Para FOMC:

- dovish;
- neutral;
- hawkish.

La vista muestra una matriz orientativa de posible primera reacción para:

- BTC / crypto;
- Nasdaq;
- S&P 500;
- DXY;
- Treasury yields.

Esta matriz es heurística y educativa. No es una predicción de precio ni señal de trading. La reacción puede cambiar por revisiones, componentes internos, posicionamiento previo y comunicación posterior.

## Noticias

Cada noticia recibe:

- impacto: bajo / medio / alto;
- categoría: FED / macro / crypto / regulación / mercados / geopolítica / general;
- fuente;
- hora relativa;
- marca `OFICIAL` cuando proviene directamente de Federal Reserve.

La clasificación es determinística por palabras clave para que el comportamiento sea auditable y no requiera un servicio de IA pago en cada request.

## Validación

El PR debe pasar:

```bash
npm test
npm run lint
npm run typecheck
npm run build:web
```
