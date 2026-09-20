"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Liquidation,
  MarketMetrics,
  MarketSnapshot,
  OrderBook,
  SourceStatus,
  StreamEvent,
} from "./types";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/market";

type ConnectionState = "connecting" | "live" | "reconnecting";

export function useMarketStream() {
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;

    Promise.all(
      SYMBOLS.map(async (symbol) => {
        const response = await fetch(`${API_URL}/api/market/${symbol}/snapshot`);
        if (!response.ok) throw new Error(`snapshot ${response.status}`);
        return (await response.json()) as MarketSnapshot;
      }),
    )
      .then((items) => {
        if (!active) return;
        setSnapshots(Object.fromEntries(items.map((item) => [item.symbol, item])));
      })
      .catch(() => setConnection("reconnecting"));

    const connect = () => {
      if (!active) return;
      setConnection(retry ? "reconnecting" : "connecting");
      socket = new WebSocket(`${WS_URL}?symbols=${SYMBOLS.join(",")}`);
      socket.onopen = () => {
        retry = 0;
        setConnection("live");
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data as string) as StreamEvent;
        setSnapshots((current) => reduceEvent(current, event));
      };
      socket.onclose = () => {
        if (!active) return;
        setConnection("reconnecting");
        retry += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(retry, 5));
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  return useMemo(() => ({ snapshots, connection, symbols: SYMBOLS }), [snapshots, connection]);
}
function reduceEvent(
  current: Record<string, MarketSnapshot>,
  event: StreamEvent,
): Record<string, MarketSnapshot> {
  if (event.type === "market.snapshot") {
    const snapshot = event.data as MarketSnapshot;
    return { ...current, [snapshot.symbol]: snapshot };
  }

  const data = event.data as { symbol?: string };
  if (!data.symbol || !current[data.symbol]) {
    if (event.type === "source.status") return updateSourceAcrossSnapshots(current, event.data as SourceStatus);
    return current;
  }

  const snapshot = current[data.symbol];
  if (event.type === "orderbook.update") {
    const book = event.data as OrderBook;
    return replaceSnapshot(current, snapshot, {
      order_books: upsert(snapshot.order_books, book, (item) => item.exchange),
    });
  }
  if (event.type === "metrics.update") {
    const metric = event.data as MarketMetrics;
    return replaceSnapshot(current, snapshot, {
      metrics: upsert(snapshot.metrics, metric, (item) => item.exchange),
    });
  }
  if (event.type === "liquidation.event") {
    const liquidation = event.data as Liquidation;
    return replaceSnapshot(current, snapshot, {
      liquidations: [...snapshot.liquidations.slice(-99), liquidation],
    });
  }
  return current;
}

function replaceSnapshot(
  current: Record<string, MarketSnapshot>,
  snapshot: MarketSnapshot,
  update: Partial<MarketSnapshot>,
) {
  return {
    ...current,
    [snapshot.symbol]: { ...snapshot, ...update, ts: Date.now() },
  };
}

function upsert<T>(items: T[], next: T, key: (item: T) => string): T[] {
  return [...items.filter((item) => key(item) !== key(next)), next];
}

function updateSourceAcrossSnapshots(
  current: Record<string, MarketSnapshot>,
  status: SourceStatus,
) {
  return Object.fromEntries(
    Object.entries(current).map(([symbol, snapshot]) => [
      symbol,
      {
        ...snapshot,
        sources: upsert(snapshot.sources, status, (item) => item.exchange),
      },
    ]),
  );
}
