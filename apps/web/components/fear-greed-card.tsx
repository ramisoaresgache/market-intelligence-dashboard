"use client";

import { useEffect, useState } from "react";
import type { FearGreedReading } from "../lib/market/fear-greed";
import { InfoTooltip } from "./info-tooltip";

export function FearGreedCard() {
  const [reading, setReading] = useState<FearGreedReading | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/fear-greed", { signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        setReading(await response.json() as FearGreedReading);
        setUnavailable(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setUnavailable(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  const value = reading?.value ?? 50;
  const angle = Math.PI - (value / 100) * Math.PI;
  const markerX = 60 + 43 * Math.cos(angle);
  const markerY = 58 - 43 * Math.sin(angle);

  return (
    <div className="fear-greed-card">
      <div className="fear-greed-title">
        <span>MIEDO Y CODICIA · BTC</span>
        <InfoTooltip
          label="Índice de miedo y codicia"
          text="Indicador diario de sentimiento de Bitcoin entre 0 y 100. Valores bajos reflejan miedo y valores altos, codicia. Es contexto de mercado, no una señal de compra o venta."
        />
      </div>
      <svg viewBox="0 0 120 72" aria-hidden="true">
        <defs>
          <linearGradient id="fear-greed-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="#ff476f" />
            <stop offset=".5" stopColor="#f2ce58" />
            <stop offset="1" stopColor="#2ee6aa" />
          </linearGradient>
        </defs>
        <path d="M17 58 A43 43 0 0 1 103 58" fill="none" stroke="#202b39" strokeWidth="8" strokeLinecap="round" />
        <path d="M17 58 A43 43 0 0 1 103 58" fill="none" stroke="url(#fear-greed-gradient)" strokeWidth="8" strokeLinecap="round" />
        {reading ? <circle cx={markerX} cy={markerY} r="4" fill="#f4f8fb" stroke="#0a1019" strokeWidth="2" /> : null}
        <text x="60" y="48" textAnchor="middle" className="fear-greed-value">{reading ? reading.value : "—"}</text>
        <text x="60" y="62" textAnchor="middle" className="fear-greed-label">{unavailable ? "No disponible" : reading?.classification ?? "Cargando"}</text>
      </svg>
      <small>Fuente: <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noreferrer">Alternative.me</a></small>
    </div>
  );
}
