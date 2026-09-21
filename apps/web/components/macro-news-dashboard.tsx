"use client";

import { useEffect, useMemo, useState } from "react";
import { scenarioOptions } from "../lib/macro/impact";
import type {
  AssetBias,
  MacroApiResponse,
  MacroEvent,
  MacroImpact,
  MacroScenario,
  NewsApiResponse,
  NewsCategory,
  NewsImpact,
  SourceHealth,
} from "../lib/macro/types";
import styles from "./macro-news-dashboard.module.css";

const MACRO_REFRESH_MS = 60_000;
const NEWS_REFRESH_MS = 300_000;
const RECENT_EVENT_WINDOW_MS = 12 * 3_600_000;

const categoryLabels: Record<NewsCategory, string> = {
  fed: "FED",
  macro: "Macro",
  crypto: "Crypto",
  regulation: "Regulación",
  markets: "Mercados",
  geopolitics: "Geopolítica",
  other: "General",
};

export function MacroNewsDashboard() {
  const [macro, setMacro] = useState<MacroApiResponse | null>(null);
  const [news, setNews] = useState<NewsApiResponse | null>(null);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    async function loadMacro() {
      try {
        const response = await fetch("/api/macro", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as MacroApiResponse;
        if (active) {
          setMacro(payload);
          setMacroError(null);
        }
      } catch (error) {
        if (active) setMacroError(error instanceof Error ? error.message : "No disponible");
      }
    }

    void loadMacro();
    const timer = window.setInterval(() => void loadMacro(), MACRO_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadNews() {
      try {
        const response = await fetch("/api/news", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as NewsApiResponse;
        if (active) {
          setNews(payload);
          setNewsError(null);
        }
      } catch (error) {
        if (active) setNewsError(error instanceof Error ? error.message : "No disponible");
      }
    }

    void loadNews();
    const timer = window.setInterval(() => void loadNews(), NEWS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleEvents = useMemo(() => {
    const events = macro?.events ?? [];
    return events
      .filter((event) => event.timestamp >= now - RECENT_EVENT_WINDOW_MS)
      .sort((a, b) => {
        const aFuture = a.timestamp >= now;
        const bFuture = b.timestamp >= now;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        return aFuture ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
      })
      .slice(0, 14);
  }, [macro, now]);

  const highImpactCount = visibleEvents.filter((event) => event.impact === "high").length;
  const upcoming = visibleEvents.find((event) => event.timestamp >= now);

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className="eyebrow">MACRO · FED · NOTICIAS</p>
          <h1>Noticias, Macro y Expectativas</h1>
          <p>
            Calendario económico, consenso y noticias que pueden mover crypto y mercados. Los escenarios
            muestran sensibilidad teórica frente a una sorpresa, no predicen el movimiento real del precio.
          </p>
        </div>
        <div className={styles.heroStats}>
          <HeroStat label="Próximo evento" value={upcoming ? countdown(upcoming.timestamp, now) : "—"} />
          <HeroStat label="Alto impacto visibles" value={String(highImpactCount)} />
          <HeroStat
            label="Última actualización"
            value={macro?.generatedAt ? formatClock(macro.generatedAt) : "Conectando…"}
          />
        </div>
      </header>

      <section className={styles.sourceStrip} aria-label="Estado de fuentes macro y noticias">
        {combineSources(macro?.sources, news?.sources).map((source) => (
          <SourceBadge key={source.id} source={source} />
        ))}
        {!macro && !news && !macroError && !newsError && (
          <span className={styles.loadingSource}>Conectando fuentes públicas…</span>
        )}
      </section>

      {(macroError || newsError) && (
        <div className={styles.partialWarning}>
          Algunos módulos no pudieron actualizarse: {[macroError && `macro (${macroError})`, newsError && `noticias (${newsError})`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      <section className={styles.dashboardGrid}>
        <div className={styles.calendarColumn}>
          <div className={styles.sectionHead}>
            <div>
              <span className="kicker">CALENDARIO ECONÓMICO</span>
              <h2>Eventos y expectativas</h2>
              <p>Hora mostrada en tu zona local. El dato real se actualiza cuando la fuente de consenso lo publica.</p>
            </div>
            <span className={styles.liveBadge}>AUTO · 60 s</span>
          </div>

          <div className={styles.events}>
            {visibleEvents.map((event) => (
              <MacroEventCard event={event} now={now} key={event.id} />
            ))}
            {!visibleEvents.length && (
              <div className={styles.emptyState}>
                {macro ? "No hay eventos relevantes dentro de la ventana actual." : "Cargando calendario…"}
              </div>
            )}
          </div>
        </div>

        <aside className={styles.newsColumn}>
          <div className={styles.sectionHead}>
            <div>
              <span className="kicker">NOTICIAS RELEVANTES</span>
              <h2>Feed por impacto</h2>
              <p>Federal Reserve oficial + cobertura global agregada por GDELT.</p>
            </div>
            <span className={styles.liveBadge}>AUTO · 5 min</span>
          </div>

          <div className={styles.newsList}>
            {(news?.items ?? []).slice(0, 20).map((item) => (
              <a
                className={styles.newsItem}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                key={item.id}
              >
                <div className={styles.newsMeta}>
                  <ImpactBadge impact={item.impact} />
                  <span>{categoryLabels[item.category]}</span>
                  {item.official && <span className={styles.official}>OFICIAL</span>}
                  <time>{relativeTime(item.publishedAt, now)}</time>
                </div>
                <h3>{item.title}</h3>
                {item.summary && <p>{item.summary}</p>}
                <div className={styles.newsSource}>
                  <span>{item.source}</span>
                  <span aria-hidden="true">↗</span>
                </div>
              </a>
            ))}
            {!news?.items?.length && (
              <div className={styles.emptyState}>{news ? "No llegaron noticias relevantes." : "Cargando noticias…"}</div>
            )}
          </div>
        </aside>
      </section>

      <section className={styles.methodology}>
        <span className="kicker">CÓMO LEERLO</span>
        <div>
          <p>
            <b>Esperado</b> es el consenso disponible; <b>real</b> es el dato publicado. La diferencia determina
            menor / en línea / mayor. En FED se traduce a dovish / neutral / hawkish cuando existe una comparación
            cuantificable de tasa.
          </p>
          <p>
            Las flechas de BTC, Nasdaq, S&amp;P 500, DXY y yields son una matriz orientativa de primera reacción.
            Posicionamiento, revisiones, componentes internos y el mensaje de Powell pueden invertir esa lectura.
          </p>
        </div>
      </section>
    </>
  );
}

function MacroEventCard({ event, now }: { event: MacroEvent; now: number }) {
  const options = scenarioOptions(event.kind);
  const activeScenario = event.scenario;

  return (
    <article className={styles.eventCard}>
      <div className={styles.eventTop}>
        <div className={styles.dateBox}>
          <strong>{formatDay(event.timestamp)}</strong>
          <span>{formatMonth(event.timestamp)}</span>
          <time>{formatClock(event.timestamp)}</time>
        </div>
        <div className={styles.eventTitle}>
          <div className={styles.badges}>
            <ImpactBadge impact={event.impact} />
            {event.verifiedOfficial && <span className={styles.official}>FECHA OFICIAL</span>}
            {event.scenario && <ScenarioBadge scenario={event.scenario} />}
          </div>
          <h3>{event.title}</h3>
          <div className={styles.eventSubline}>
            <span className={event.timestamp > now ? styles.countdown : styles.pastCountdown}>
              {countdown(event.timestamp, now)}
            </span>
            {event.reference && <span>{event.reference}</span>}
            {event.sourceUrl ? (
              <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                {event.source} ↗
              </a>
            ) : (
              <span>{event.source}</span>
            )}
          </div>
        </div>
      </div>

      <div className={styles.values}>
        <DataPoint label="Anterior" value={event.previous} />
        <DataPoint label="Esperado" value={event.forecast} emphasis="forecast" />
        <DataPoint label="Real" value={event.actual} emphasis={event.actual ? "actual" : undefined} />
      </div>

      <div className={styles.scenarios}>
        <div className={styles.scenarioHeader}>
          <span>Escenario</span>
          <span>Posible primera reacción</span>
        </div>
        {options.map((option) => (
          <div
            className={`${styles.scenarioRow} ${activeScenario === option.key ? styles.activeScenario : ""}`}
            key={option.key}
          >
            <div className={styles.scenarioCopy}>
              <b>{option.label}</b>
              <small>{option.description}</small>
            </div>
            <div className={styles.assetImpacts}>
              {option.impacts.map((impact) => (
                <span className={styles.assetImpact} data-bias={impact.bias} key={impact.asset}>
                  {assetShortName(impact.asset)} <b>{biasIcon(impact.bias)}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {event.expectationsSource && (
        <p className={styles.expectationFootnote}>Consenso / actual: {event.expectationsSource}</p>
      )}
    </article>
  );
}

function DataPoint({
  label,
  value,
  emphasis,
}: {
  label: string;
  value?: string | null;
  emphasis?: "forecast" | "actual";
}) {
  return (
    <div className={styles.dataPoint} data-emphasis={emphasis ?? "none"}>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: MacroImpact | NewsImpact }) {
  const labels: Record<MacroImpact, string> = { high: "ALTO", medium: "MEDIO", low: "BAJO" };
  return (
    <span className={styles.impactBadge} data-impact={impact}>
      {labels[impact]}
    </span>
  );
}

function ScenarioBadge({ scenario }: { scenario: MacroScenario }) {
  const labels: Record<MacroScenario, string> = {
    lower: "MENOR",
    inline: "EN LÍNEA",
    higher: "MAYOR",
    dovish: "DOVISH",
    neutral: "NEUTRAL",
    hawkish: "HAWKISH",
  };
  return (
    <span className={styles.scenarioBadge} data-scenario={scenario}>
      REAL: {labels[scenario]}
    </span>
  );
}

function SourceBadge({ source }: { source: SourceHealth }) {
  return (
    <span className={styles.sourceBadge} data-status={source.status} title={source.detail}>
      <i /> {source.label}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.heroStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function combineSources(macro?: SourceHealth[], news?: SourceHealth[]): SourceHealth[] {
  const all = [...(macro ?? []), ...(news ?? [])];
  const seen = new Set<string>();
  return all.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

function countdown(timestamp: number, now: number): string {
  const delta = timestamp - now;
  if (Math.abs(delta) < 60_000) return delta >= 0 ? "Ahora" : "Publicado ahora";
  if (delta < 0) return `Hace ${compactDuration(Math.abs(delta))}`;
  return `En ${compactDuration(delta)}`;
}

function compactDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

function relativeTime(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) return "ahora";
  if (delta < 3_600_000) return `hace ${Math.floor(delta / 60_000)} min`;
  if (delta < 86_400_000) return `hace ${Math.floor(delta / 3_600_000)} h`;
  return `hace ${Math.floor(delta / 86_400_000)} d`;
}

function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit" }).format(timestamp);
}

function formatMonth(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", { month: "short" }).format(timestamp).replace(".", "").toUpperCase();
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function assetShortName(asset: string): string {
  if (asset === "BTC / crypto") return "BTC";
  if (asset === "Nasdaq") return "NDX";
  if (asset === "S&P 500") return "S&P";
  return asset;
}

function biasIcon(bias: AssetBias): string {
  if (bias === "bullish") return "↑";
  if (bias === "bearish") return "↓";
  if (bias === "mixed") return "↕";
  return "→";
}
