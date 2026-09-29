"use client";

import { useEffect, useState } from "react";
import {
  mergeCandles,
  parseBybitLiveCandle,
  toBybitInterval,
  type CandleSource,
  type TradingCandle,
  type TradingInterval,
} from "./trading-candles";

type TradingFeedState = "loading" | "live" | "reconnecting" | "cached" | "error";

interface CandleApiResponse {
  source: CandleSource;
  candles: TradingCandle[];
  warnings?: string[];
}

export interface TradingCandleState {
  candles: TradingCandle[];
  state: TradingFeedState;
  historySource: CandleSource | null;
  error: string | null;
}

const DB_NAME = "market-intelligence-candles";
const STORE_NAME = "series";
const BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";

export function useTradingCandles(
  symbol: string,
  interval: TradingInterval,
): TradingCandleState {
  const [candles, setCandles] = useState<TradingCandle[]>([]);
  const [state, setState] = useState<TradingFeedState>("loading");
  const [historySource, setHistorySource] = useState<CandleSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeKey = `${symbol}:${interval}`;
  const [loadedKey, setLoadedKey] = useState(activeKey);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let series: TradingCandle[] = [];
    const cacheKey = `${symbol}:${interval}`;

    void loadHistory();
    connect(0);

    async function loadHistory() {
      try {
        const cached = await readCachedCandles(cacheKey);
        if (!cancelled && cached.length) {
          commitCandles(cached);
          setHistorySource(null);
          setError(null);
          setState((current) => current === "live" ? current : "cached");
        }

        const response = await fetch(
          `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=1000`,
        );
        const payload = await response.json() as CandleApiResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Histórico HTTP ${response.status}`);
        if (cancelled) return;
        setHistorySource(payload.source);
        commitCandles(payload.candles, true);
        setError(payload.warnings?.length ? payload.warnings.join(" · ") : null);
        setState((current) => current === "live" ? current : "cached");
      } catch (reason) {
        if (cancelled) return;
        if (!series.length) commitCandles([]);
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el histórico");
        setState((current) => current === "live" || current === "cached" ? current : "error");
      }
    }

    function connect(attempt: number) {
      if (cancelled) return;
      socket = new WebSocket(BYBIT_WS);
      socket.onopen = () => {
        if (cancelled || !socket) return;
        socket.send(JSON.stringify({
          op: "subscribe",
          args: [`kline.${toBybitInterval(interval)}.${symbol}`],
        }));
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
        }, 20_000);
      };
      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as { topic?: string; data?: unknown };
          if (payload.topic !== `kline.${toBybitInterval(interval)}.${symbol}` || !Array.isArray(payload.data)) return;
          const updates = payload.data.flatMap((item) => {
            const candle = parseBybitLiveCandle(item);
            return candle ? [candle] : [];
          });
          if (!updates.length) return;
          const hasClosedCandle = payload.data.some((item) => isRecord(item) && item.confirm === true);
          commitCandles(updates, hasClosedCandle);
          setState("live");
          setError(null);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Vela en vivo inválida");
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (cancelled) return;
        setState("reconnecting");
        const delay = Math.min(15_000, 750 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(() => connect(attempt + 1), delay);
      };
    }

    function commitCandles(incoming: TradingCandle[], persist = false) {
      if (cancelled) return;
      series = mergeCandles(series, incoming);
      setLoadedKey(cacheKey);
      setCandles(series);
      if (persist) void writeCachedCandles(cacheKey, series);
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "view changed");
    };
  }, [interval, symbol]);

  if (loadedKey !== activeKey) {
    return { candles: [], state: "loading", historySource: null, error: null };
  }
  return { candles, state, historySource, error };
}

async function readCachedCandles(key: string): Promise<TradingCandle[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  return new Promise((resolve) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => {
      const record = request.result as { candles?: TradingCandle[] } | undefined;
      resolve(Array.isArray(record?.candles) ? record.candles : []);
    };
    request.onerror = () => resolve([]);
  });
}

async function writeCachedCandles(key: string, candles: TradingCandle[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, candles: candles.slice(-2_000), savedAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // IndexedDB can be disabled in private browsing; the live feed remains usable.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
