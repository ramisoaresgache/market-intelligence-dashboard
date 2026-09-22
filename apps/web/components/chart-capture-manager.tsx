"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { shareGraphic, type ShareableGraphic } from "../lib/chart-export";

type CaptureTarget = {
  element: ShareableGraphic;
  host: HTMLElement;
  filename: string;
};

export function ChartCaptureManager() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((value) => value + 1));
    observer.observe(document.body, { childList: true, subtree: true });
    const onResize = () => setRevision((value) => value + 1);
    window.addEventListener("resize", onResize);
    setRevision((value) => value + 1);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const targets = useMemo(() => collectTargets(), [revision]);

  return (
    <>
      {targets.map((target, index) =>
        createPortal(
          <CaptureButton target={target} />,
          target.host,
          `${target.filename}-${index}`,
        ),
      )}
    </>
  );
}

function CaptureButton({ target }: { target: CaptureTarget }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="chart-capture-button"
      title="Capturar / compartir gráfico"
      aria-label="Capturar o compartir gráfico"
      disabled={busy}
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setBusy(true);
        try {
          await shareGraphic(target.element, target.filename);
        } catch (error) {
          console.error("No se pudo compartir el gráfico", error);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : "📷"}
    </button>
  );
}

function collectTargets(): CaptureTarget[] {
  if (typeof document === "undefined") return [];
  const graphics = [
    ...document.querySelectorAll<HTMLCanvasElement>("main canvas"),
    ...document.querySelectorAll<SVGSVGElement>(".market-pulse-chart svg, .exchange-chart-card svg"),
  ];

  const seen = new Set<Element>();
  return graphics.flatMap((element, index) => {
    if (seen.has(element)) return [];
    seen.add(element);
    const host = resolveHost(element);
    if (!host) return [];
    host.classList.add("chart-capture-host");
    return [{
      element,
      host,
      filename: filenameFor(element, index),
    }];
  });
}

function resolveHost(element: ShareableGraphic): HTMLElement | null {
  if (element instanceof HTMLCanvasElement) {
    return element.parentElement;
  }
  return element.closest<HTMLElement>(".exchange-chart-card, .market-pulse-chart") ?? element.parentElement;
}

function filenameFor(element: ShareableGraphic, index: number): string {
  const label = element.getAttribute("aria-label") ||
    element.closest(".exchange-chart-card")?.querySelector("strong")?.textContent ||
    `grafico-${index + 1}`;
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `market-intelligence-${slug || `grafico-${index + 1}`}.png`;
}
