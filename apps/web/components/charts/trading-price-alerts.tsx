"use client";

import { useEffect, useRef, useState } from "react";

type AlertDirection = "above" | "below";
type PriceAlert = { id: string; symbol: string; direction: AlertDirection; target: number; firedAt?: number };
const STORAGE_KEY = "mi-price-alerts-v1";

export function crossedThreshold(previous: number, current: number, target: number, direction: AlertDirection): boolean {
  return direction === "above" ? previous <= target && current > target : previous >= target && current < target;
}

export function TradingPriceAlerts({ symbol, price, live }: { symbol: string; price?: number; live: boolean }) {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const previousPrice = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
        if (Array.isArray(saved)) setAlerts(saved.filter(isPriceAlert));
      } catch { /* Invalid local data: start with no alerts. */ }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  }, [alerts, loaded]);

  useEffect(() => {
    if (!live || price == null || !Number.isFinite(price)) return;
    const previous = previousPrice.current;
    previousPrice.current = price;
    if (previous == null || previous === price) return;
    const fired = alerts.filter((alert) => alert.symbol === symbol && !alert.firedAt && crossedThreshold(previous, price, alert.target, alert.direction));
    if (!fired.length) return;
    const firedIds = new Set(fired.map((alert) => alert.id));
    setAlerts((current) => current.map((alert) => firedIds.has(alert.id) ? { ...alert, firedAt: Date.now() } : alert));
    setNotice(`${symbol}: ${fired.length} alerta${fired.length === 1 ? "" : "s"} de precio activada${fired.length === 1 ? "" : "s"}.`);
  }, [alerts, live, price, symbol]);

  function createAlert() {
    const parsed = Number(target.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("Ingresá un precio válido mayor que cero."); return; }
    setAlerts((current) => [...current, { id: crypto.randomUUID(), symbol, direction, target: parsed }]);
    setTarget("");
    setError("");
  }

  const current = alerts.filter((alert) => alert.symbol === symbol);
  return <section className="trading-alerts" aria-label="Alertas de precio">
    <div className="trading-alert-head"><div><span className="section-kicker">ALERTAS PERSONALES</span><h3>Alertas de precio</h3></div><small>Se evalúan mientras esta pestaña está abierta</small></div>
    <div className="trading-alert-form"><select aria-label="Condición de alerta" value={direction} onChange={(event) => setDirection(event.target.value as AlertDirection)}><option value="above">Cruza por encima</option><option value="below">Cruza por debajo</option></select><input aria-label="Precio objetivo USDT" type="number" min="0" step="any" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Precio en USDT" /><button type="button" onClick={createAlert}>Crear alerta</button></div>
    {error ? <p className="trading-alert-error">{error}</p> : null}
    {notice ? <div className="trading-alert-notice" role="status"><span>{notice}</span><button type="button" aria-label="Cerrar aviso de alerta" onClick={() => setNotice("")}>×</button></div> : null}
    <div className="trading-alert-list">{current.map((alert) => <div key={alert.id}><b>{alert.direction === "above" ? "↑" : "↓"} ${alert.target.toLocaleString("en-US")}</b><span>{alert.firedAt ? `Activada ${new Date(alert.firedAt).toLocaleString("es-AR", { hour12: false })}` : "Activa"}</span><button type="button" aria-label={`Eliminar alerta ${alert.target}`} onClick={() => setAlerts((items) => items.filter((item) => item.id !== alert.id))}>Quitar</button></div>)}{!current.length ? <p>Todavía no hay alertas para {symbol}.</p> : null}</div>
  </section>;
}

function isPriceAlert(value: unknown): value is PriceAlert {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PriceAlert>;
  return typeof item.id === "string" && typeof item.symbol === "string" && (item.direction === "above" || item.direction === "below") && typeof item.target === "number" && Number.isFinite(item.target) && item.target > 0 && (item.firedAt === undefined || typeof item.firedAt === "number");
}
