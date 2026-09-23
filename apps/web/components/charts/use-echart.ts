"use client";

import * as echarts from "echarts";
import { useCallback, useEffect, useRef, type RefObject } from "react";

export function useEChart(option: echarts.EChartsOption): {
  containerRef: RefObject<HTMLDivElement | null>;
  reset: () => void;
  exportPng: (filename: string) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { replaceMerge: ["series", "visualMap"] });
  }, [option]);

  const reset = useCallback(() => {
    chartRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  }, []);

  const exportPng = useCallback((filename: string) => {
    const chart = chartRef.current;
    if (!chart) return;
    const anchor = document.createElement("a");
    anchor.download = filename;
    anchor.href = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#070b12" });
    anchor.click();
  }, []);

  return { containerRef, reset, exportPng };
}
