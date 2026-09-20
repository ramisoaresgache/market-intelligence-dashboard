import type { LiquidityFrame } from "./types";

const DB_NAME = "market-intelligence";
const DB_VERSION = 1;
const STORE = "liquidity-frames";

export async function saveLiquidityFrame(frame: LiquidityFrame): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await transactionDone(db, "readwrite", (store) => store.put(frame));
  db.close();
}

export async function loadLiquidityFrames(symbol: string, sinceMs: number): Promise<LiquidityFrame[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const frames = await new Promise<LiquidityFrame[]>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
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
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as LiquidityFrame;
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
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["symbol", "ts"] });
        store.createIndex("symbol", "symbol", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
  });
}

function transactionDone(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló IndexedDB"));
  });
}
