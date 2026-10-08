"use client";

import { useEffect, useState } from "react";
import {
  mergeCandles,
  parseBingxLiveCandle,
  parseBybitLiveCandle,
  toBingxInstrument,
  toBybitInterval,
  type CandleSource,
  type TradingCandle,
  type TradingInterval,
} from "./trading-candles";
import { decodeBingxFrame } from "./adapters/bingx";

type TradingFeedState = "loading" | "live" | "reconnecting" | "cached" | "polling" | "error";

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
const BINGX_WS = "wss://open-api-swap.bingx.com/swap-market";

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
    const cacheKey = `bingx-primary:${symbol}:${interval}`;

    void loadHistory();

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
        series = [];
        commitCandles(payload.candles, true);
        setError(payload.warnings?.length ? payload.warnings.join(" · ") : null);
        setState((current) => current === "live" ? current : "cached");
        if (payload.source === "bingx" || payload.source === "bybit") connect(payload.source, 0);
        else startPolling();
      } catch (reason) {
        if (cancelled) return;
        if (!series.length) commitCandles([]);
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el histórico");
        setState((current) => current === "live" || current === "cached" ? current : "error");
        connect("bingx", 0);
      }
    }

    function startPolling() {
      const poll = async () => {
        if (cancelled) return;
        try {
          const response = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&source=okx&limit=300`);
          if (!response.ok) throw new Error(`OKX HTTP ${response.status}`);
          const payload = await response.json() as CandleApiResponse;
          commitCandles(payload.candles, true);
          setState("polling");
        } catch { /* Keep last known candles. */ }
        if (!cancelled) retryTimer = setTimeout(poll, 30_000);
      };
      retryTimer = setTimeout(poll, 30_000);
    }

    function connect(source: "bingx" | "bybit", attempt: number) {
      if (cancelled) return;
      const currentSocket = new WebSocket(source === "bingx" ? BINGX_WS : BYBIT_WS);
      currentSocket.binaryType = "arraybuffer";
      socket = currentSocket;
      const bingxChannel = `${toBingxInstrument(symbol)}@kline_${interval}`;
      const bybitChannel = `kline.${toBybitInterval(interval)}.${symbol}`;
      currentSocket.onopen = () => {
        if (cancelled || currentSocket.readyState !== WebSocket.OPEN) return;
        currentSocket.send(JSON.stringify(source === "bingx"
          ? { id: crypto.randomUUID(), reqType: "sub", dataType: bingxChannel }
          : { op: "subscribe", args: [bybitChannel] }));
        if (source === "bybit") heartbeat = setInterval(() => {
          if (currentSocket.readyState === WebSocket.OPEN) currentSocket.send(JSON.stringify({ op: "ping" }));
        }, 20_000);
      };
      currentSocket.onmessage = (message) => { void (async () => {
        try {
          const raw = source === "bingx" ? await decodeBingxFrame(message.data) : String(message.data);
          if (raw === "Ping") {
            if (currentSocket.readyState === WebSocket.OPEN) currentSocket.send("Pong");
            return;
          }
          const payload = JSON.parse(raw) as { topic?: string; dataType?: string; data?: unknown };
          const updates = source === "bingx"
            ? payload.dataType === bingxChannel
              ? (Array.isArray(payload.data) ? payload.data : [payload.data])
                .map(parseBingxLiveCandle).filter((item): item is TradingCandle => item !== null)
              : []
            : payload.topic === bybitChannel && Array.isArray(payload.data)
              ? payload.data.flatMap((item) => {
                const candle = parseBybitLiveCandle(item);
                return candle ? [candle] : [];
              })
              : [];
          if (!updates.length) return;
          const hasClosedCandle = source === "bingx" || (Array.isArray(payload.data) && payload.data.some((item) => isRecord(item) && item.confirm === true));
          commitCandles(updates, hasClosedCandle);
          setState("live");
          setError(null);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Vela en vivo inválida");
        }
      })(); };
      currentSocket.onerror = () => currentSocket.close();
      currentSocket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (cancelled) return;
        setState("reconnecting");
        const delay = Math.min(15_000, 750 * 2 ** Math.min(attempt, 5));
        retryTimer = setTimeout(() => connect(source, attempt + 1), delay);
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
