"use client";

import { useCallback, useEffect, useState } from "react";
import { InfoTooltip } from "./info-tooltip";

type Range = "today" | "tomorrow" | "week";
type LoadState = "loading" | "live" | "unavailable";
type Impact = "positive" | "negative" | "mixed" | "neutral";

type EconomicEvent = {
  id: string;
  date: string;
  country: string;
  countryCode: string;
  event: string;
  actual: string;
  forecast: string;
  previous: string;
  importance: number;
  impact: Impact;
  summary: string;
};

type NewsArticle = {
  url: string;
  title: string;
  publishedAt: string | null;
  domain: string;
  sourceCountry: string;
};

const rangeLabels: Record<Range, string> = {
  today: "Hoy",
  tomorrow: "Mañana",
  week: "Esta semana",
};

const impactLabels: Record<Impact, string> = {
  positive: "Favorable",
  negative: "Desfavorable",
  mixed: "Mixto",
  neutral: "Neutral",
};

export function NewsIntelligence() {
  const [range, setRange] = useState<Range>("today");
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [calendarState, setCalendarState] = useState<LoadState>("loading");
  const [newsState, setNewsState] = useState<LoadState>("loading");
  const [calendarMessage, setCalendarMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setCalendarState("loading");
    setNewsState("loading");
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/economic-calendar?range=${range}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar el calendario");
        setEvents(payload.events ?? []);
        setCalendarMessage(payload.message ?? "");
        setCalendarState(payload.state ?? "unavailable");
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setEvents([]);
          setCalendarMessage(error.message);
          setCalendarState("unavailable");
        }
      });
    return () => controller.abort();
  }, [range, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/news", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las noticias");
        setArticles(payload.articles ?? []);
        setNewsState(payload.state ?? "unavailable");
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setArticles([]);
          setNewsState("unavailable");
        }
      });
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <section className="news-intelligence">
      <header className="news-intelligence-head">
        <div>
          <span className="section-kicker">NOTICIAS Y MACRO · FUENTES REALES</span>
          <h2>Calendario económico e inteligencia para cripto</h2>
          <p>Publicaciones en español y sorpresas macro comparadas contra el consenso. Horarios expresados en UTC.</p>
        </div>
        <button type="button" className="news-refresh" onClick={refresh} aria-label="Actualizar noticias y calendario">↻ Actualizar</button>
      </header>

      <div className="news-layout">
        <section className="economic-calendar-panel">
          <div className="calendar-toolbar">
            <div>
              <strong>Calendario económico</strong>
              <span>IMPACTO ESPERADO EN CRIPTO</span>
            </div>
            <nav aria-label="Rango del calendario">
              {(Object.keys(rangeLabels) as Range[]).map((item) => (
                <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => { setCalendarState("loading"); setRange(item); }}>{rangeLabels[item]}</button>
              ))}
            </nav>
          </div>

          {calendarState === "loading" ? (
            <PanelState text="Cargando publicaciones macro…" />
          ) : calendarState === "unavailable" ? (
            <PanelState text={calendarMessage || "La fuente del calendario no está disponible."} />
          ) : events.length === 0 ? (
            <PanelState text="No hay publicaciones relevantes en este rango." />
          ) : (
            <div className="economic-table-wrap">
              <table className="economic-table">
                <thead><tr><th>Hora UTC</th><th>País</th><th>Evento</th><th>Importancia</th><th>Actual</th><th>Previsión</th><th>Anterior</th><th>Lectura cripto</th></tr></thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td><time dateTime={event.date}>{utcTime(event.date)}</time></td>
                      <td><span className="country-code">{event.countryCode}</span>{event.country}</td>
                      <td><strong>{event.event}</strong></td>
                      <td><Importance value={event.importance} /></td>
                      <td className="event-value actual">{event.actual}</td>
                      <td className="event-value">{event.forecast}</td>
                      <td className="event-value">{event.previous}</td>
                      <td><div className="impact-reading"><span className={`impact-badge ${event.impact}`}>{impactLabels[event.impact]}</span><InfoTooltip label={`Impacto ${impactLabels[event.impact]}`} text={event.summary} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="calendar-disclaimer">La lectura cripto describe una reacción habitual condicionada por la sorpresa del dato; no es una predicción ni asesoramiento financiero. Fuente gratuita: <a href="https://www.financecalendar.com" target="_blank" rel="noopener noreferrer">Finance Calendar</a>.</p>
        </section>

        <aside className="spanish-news-panel">
          <header><div><strong>Noticias importantes</strong><span>PUBLICADAS EN ESPAÑOL</span></div><i className={newsState === "live" ? "live" : ""}>{newsState === "live" ? "EN VIVO" : newsState.toUpperCase()}</i></header>
          {newsState === "loading" ? <PanelState text="Buscando noticias en español…" /> : newsState === "unavailable" ? <PanelState text="GDELT no está disponible en este momento." /> : (
            <div className="news-feed">
              {articles.slice(0, 14).map((article) => (
                <a key={article.url} href={article.url} target="_blank" rel="noopener noreferrer">
                  <span>{article.domain}</span>
                  <strong>{article.title}</strong>
                  <small>{article.publishedAt ? `${utcDateTime(article.publishedAt)} UTC` : "Hora no informada"}{article.sourceCountry ? ` · ${article.sourceCountry}` : ""}</small>
                </a>
              ))}
              {!articles.length ? <PanelState text="No se encontraron noticias en español durante la última semana." /> : null}
            </div>
          )}
          <footer>Fuente: GDELT DOC 2.0 · Los titulares enlazan al medio original.</footer>
        </aside>
      </div>
    </section>
  );
}

function Importance({ value }: { value: number }) {
  return <span className="importance-dots" aria-label={`Importancia ${value} de 3`}>{[1, 2, 3].map((level) => <i key={level} className={level <= value ? "active" : ""} />)}</span>;
}

function PanelState({ text }: { text: string }) {
  return <div className="news-panel-state"><span className="pulse-dot" />{text}</div>;
}

function utcTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date);
}

function utcDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date);
}
