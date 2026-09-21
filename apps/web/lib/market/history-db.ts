import { liquidationEventKey } from "./liquidation-history";
import type { LiquidationEvent, LiquidityFrame } from "./types";

const DB_NAME = "market-intelligence";
const DB_VERSION = 2;
const LIQUIDITY_STORE = "liquidity-frames";
const LIQUIDATION_STORE = "liquidation-events";

interface StoredLiquidationEvent extends LiquidationEvent {
  id: string;
}

export async function saveLiquidityFrame(frame: LiquidityFrame): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await transactionDone(db, LIQUIDITY_STORE, "readwrite", (store) => store.put(frame));
  db.close();
}

export async function loadLiquidityFrames(symbol: string, sinceMs: number): Promise<LiquidityFrame[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const frames = await new Promise<LiquidityFrame[]>((resolve, reject) => {
    const transaction = db.transaction(LIQUIDITY_STORE, "readonly");
    const store = transaction.objectStore(LIQUIDITY_STORE);
    const index = store.index("symbol");
    const request = index.getAll(IDBKeyRange.only(symbol));
    request.onsuccess = () =>
      resolve((request.result as LiquidityFrame[]).filter((frame) => frame.ts >= sinceMs));
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer IndexedDB"));
  });
  db.close();
  return frames.sort((left, right) => left.ts - right.ts);
}

export async function pruneLiquidityFrames(beforeMs: number): Promise<void> {
  await pruneStore<LiquidityFrame>(LIQUIDITY_STORE, beforeMs);
}

export async function saveLiquidationEvents(events: LiquidationEvent[]): Promise<void> {
  if (typeof indexedDB === "undefined" || !events.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(LIQUIDATION_STORE, "readwrite");
    const store = transaction.objectStore(LIQUIDATION_STORE);
    for (const event of events) {
      const stored: StoredLiquidationEvent = {
        ...event,
        id: liquidationEventKey(event),
      };
      store.put(stored);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló IndexedDB"));
  });
  db.close();
}

export async function loadLiquidationEvents(
  symbol: string,
  sinceMs: number,
): Promise<LiquidationEvent[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const events = await new Promise<StoredLiquidationEvent[]>((resolve, reject) => {
    const transaction = db.transaction(LIQUIDATION_STORE, "readonly");
    const store = transaction.objectStore(LIQUIDATION_STORE);
    const index = store.index("symbol");
    const request = index.getAll(IDBKeyRange.only(symbol));
    request.onsuccess = () =>
      resolve(
        (request.result as StoredLiquidationEvent[]).filter((event) => event.ts >= sinceMs),
      );
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer IndexedDB"));
  });
  db.close();
  return events
    .map(({ id: _id, ...event }) => event)
    .sort((left, right) => left.ts - right.ts);
}

export async function pruneLiquidationEvents(beforeMs: number): Promise<void> {
  await pruneStore<StoredLiquidationEvent>(LIQUIDATION_STORE, beforeMs);
}

async function pruneStore<T extends { ts: number }>(storeName: string, beforeMs: number): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as T;
      if (value.ts < beforeMs) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo limpiar IndexedDB"));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Falló la limpieza de IndexedDB"));
  });
  db.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LIQUIDITY_STORE)) {
        const store = db.createObjectStore(LIQUIDITY_STORE, { keyPath: ["symbol", "ts"] });
        store.createIndex("symbol", "symbol", { unique: false });
      }
      if (!db.objectStoreNames.contains(LIQUIDATION_STORE)) {
        const store = db.createObjectStore(LIQUIDATION_STORE, { keyPath: "id" });
        store.createIndex("symbol", "symbol", { unique: false });
        store.createIndex("ts", "ts", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

function transactionDone(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló IndexedDB"));
  });
}
