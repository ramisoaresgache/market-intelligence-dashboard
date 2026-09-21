import { DurableObject } from "cloudflare:workers";

const BINANCE_WS = "wss://fstream.binance.com/ws/!forceOrder@arr";
const BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";
const BUCKET_MS = 60_000;
const ALARM_MS = 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BYBIT_PING_MS = 20_000;
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const WINDOWS = [1, 4, 12, 24] as const;

type Side = "long" | "short";
type Exchange = "binance" | "bybit";

type Env = {
  LIQUIDATION_COLLECTOR: DurableObjectNamespace;
  COLLECTOR_SYMBOLS?: string;
  CORS_ORIGIN?: string;
};

type Liquidation = {
  exchange: Exchange;
  symbol: string;
  ts: number;
  side: Side;
  price: number;
  qty: number;
  notional: number;
};

type PendingBucket = {
  exchange: Exchange;
  symbol: string;
  bucketTs: number;
  longUsd: number;
  shortUsd: number;
  events: number;
};

type BucketRow = {
  exchange: Exchange;
  symbol: string;
  bucket_ts: number;
  long_usd: number;
  short_usd: number;
  events: number;
};

type ExchangeState = {
  connected: boolean;
  connecting: boolean;
  lastMessageAt: number | null;
  lastLiquidationAt: number | null;
  lastError: string | null;
  reconnects: number;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return cors(
        Response.json({
          service: "market-intelligence-collector",
          endpoints: [
            "/health",
            "/bootstrap",
            "/v1/liquidations/symbols",
            "/v1/liquidations/summary?symbol=BTCUSDT",
          ],
        }),
        env,
      );
    }

    const stub = env.LIQUIDATION_COLLECTOR.getByName("primary");
    const response = await stub.fetch(request);
    return cors(response, env);
  },
} satisfies ExportedHandler<Env>;

export class LiquidationCollector extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly symbols: Set<string>;
  private readonly pending = new Map<string, PendingBucket>();
  private readonly fingerprints = new Map<string, number>();
  private readonly sockets = new Map<Exchange, WebSocket>();
  private readonly exchangeState = new Map<Exchange, ExchangeState>();
  private bybitHeartbeat: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.symbols = new Set(parseSymbols(env.COLLECTOR_SYMBOLS));
    this.exchangeState.set("binance", freshExchangeState());
    this.exchangeState.set("bybit", freshExchangeState());

    ctx.blockConcurrencyWhile(async () => {
      this.initializeSchema();
      await this.scheduleAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    await this.ensureConnections();

    if (url.pathname === "/bootstrap") {
      return Response.json({
        ok: true,
        message: "Collector inicializado",
        symbols: [...this.symbols],
        exchanges: this.serializedExchangeState(),
      });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        generatedAt: Date.now(),
        symbols: [...this.symbols],
        pendingBuckets: this.pending.size,
        exchanges: this.serializedExchangeState(),
        storage: this.storageStats(),
      });
    }

    if (url.pathname === "/v1/liquidations/symbols") {
      return Response.json({ symbols: [...this.symbols] });
    }

    if (url.pathname === "/v1/liquidations/summary") {
      const symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
      if (!this.symbols.has(symbol)) {
        return Response.json(
          { error: `Símbolo no recolectado: ${symbol}`, supportedSymbols: [...this.symbols] },
          { status: 404 },
        );
      }
      return Response.json(this.buildSummary(symbol));
    }

    return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.flushPending();
    this.pruneOldRows();
    this.pruneFingerprints();
    await this.ensureConnections();
    await this.scheduleAlarm();
  }

  private initializeSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS liquidation_buckets (
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        bucket_ts INTEGER NOT NULL,
        long_usd REAL NOT NULL DEFAULT 0,
        short_usd REAL NOT NULL DEFAULT 0,
        events INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (exchange, symbol, bucket_ts)
      );
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_liquidation_buckets_symbol_ts
      ON liquidation_buckets(symbol, bucket_ts);
    `);
  }

  private async scheduleAlarm(): Promise<void> {
    const next = Date.now() + ALARM_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current == null || current > next) await this.ctx.storage.setAlarm(next);
  }

  private async ensureConnections(): Promise<void> {
    this.ensureBinance();
    this.ensureBybit();
    await this.scheduleAlarm();
  }

  private ensureBinance(): void {
    const current = this.sockets.get("binance");
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;

    const state = this.exchangeState.get("binance")!;
    state.connecting = true;
    state.connected = false;
    const socket = new WebSocket(BINANCE_WS);
    this.sockets.set("binance", socket);

    socket.addEventListener("open", () => {
      state.connected = true;
      state.connecting = false;
      state.lastError = null;
    });

    socket.addEventListener("message", (event) => {
      try {
        const liquidations = parseBinanceLiquidations(event.data);
        for (const liquidation of liquidations) this.record(liquidation);
        state.lastMessageAt = Date.now();
        if (liquidations.length > 0) {
          state.lastLiquidationAt = Math.max(...liquidations.map((liquidation) => liquidation.ts));
        }
        state.connected = true;
      } catch (error) {
        state.lastError = errorMessage(error);
      }
    });

    socket.addEventListener("error", () => {
      state.lastError = "Error de WebSocket Binance";
    });

    socket.addEventListener("close", () => {
      if (this.sockets.get("binance") === socket) this.sockets.delete("binance");
      state.connected = false;
      state.connecting = false;
      state.reconnects += 1;
      this.ctx.waitUntil(this.scheduleReconnect());
    });
  }

  private ensureBybit(): void {
    const current = this.sockets.get("bybit");
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;

    const state = this.exchangeState.get("bybit")!;
    state.connecting = true;
    state.connected = false;
    const socket = new WebSocket(BYBIT_WS);
    this.sockets.set("bybit", socket);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          op: "subscribe",
          args: [...this.symbols].map((symbol) => `allLiquidation.${symbol}`),
        }),
      );
      state.connected = true;
      state.connecting = false;
      state.lastError = null;
      this.startBybitHeartbeat(socket);
    });

    socket.addEventListener("message", (event) => {
      try {
        const liquidations = parseBybitLiquidations(event.data);
        for (const liquidation of liquidations) this.record(liquidation);
        state.lastMessageAt = Date.now();
        if (liquidations.length > 0) {
          state.lastLiquidationAt = Math.max(...liquidations.map((liquidation) => liquidation.ts));
        }
        state.connected = true;
      } catch (error) {
        state.lastError = errorMessage(error);
      }
    });

    socket.addEventListener("error", () => {
      state.lastError = "Error de WebSocket Bybit";
    });

    socket.addEventListener("close", () => {
      if (this.sockets.get("bybit") === socket) this.sockets.delete("bybit");
      this.stopBybitHeartbeat();
      state.connected = false;
      state.connecting = false;
      state.reconnects += 1;
      this.ctx.waitUntil(this.scheduleReconnect());
    });
  }

  private startBybitHeartbeat(socket: WebSocket): void {
    this.stopBybitHeartbeat();
    this.bybitHeartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
    }, BYBIT_PING_MS);
  }

  private stopBybitHeartbeat(): void {
    if (this.bybitHeartbeat !== null) clearInterval(this.bybitHeartbeat);
    this.bybitHeartbeat = null;
  }

  private async scheduleReconnect(): Promise<void> {
    await this.flushPending();
    const retryAt = Date.now() + 5_000;
    const current = await this.ctx.storage.getAlarm();
    if (current == null || current > retryAt) await this.ctx.storage.setAlarm(retryAt);
  }

  private record(liquidation: Liquidation): void {
    if (!this.symbols.has(liquidation.symbol)) return;
    if (!Number.isFinite(liquidation.notional) || liquidation.notional <= 0) return;

    const fingerprint = liquidationFingerprint(liquidation);
    if (this.fingerprints.has(fingerprint)) return;
    this.fingerprints.set(fingerprint, Date.now());

    const bucketTs = Math.floor(liquidation.ts / BUCKET_MS) * BUCKET_MS;
    const key = `${liquidation.exchange}|${liquidation.symbol}|${bucketTs}`;
    const bucket = this.pending.get(key) ?? {
      exchange: liquidation.exchange,
      symbol: liquidation.symbol,
      bucketTs,
      longUsd: 0,
      shortUsd: 0,
      events: 0,
    };

    if (liquidation.side === "long") bucket.longUsd += liquidation.notional;
    else bucket.shortUsd += liquidation.notional;
    bucket.events += 1;
    this.pending.set(key, bucket);
  }

  private async flushPending(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    this.flushing = true;
    const snapshot = [...this.pending.values()];
    this.pending.clear();

    try {
      for (const bucket of snapshot) {
        this.sql.exec(
          `INSERT INTO liquidation_buckets
             (exchange, symbol, bucket_ts, long_usd, short_usd, events)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(exchange, symbol, bucket_ts) DO UPDATE SET
             long_usd = long_usd + excluded.long_usd,
             short_usd = short_usd + excluded.short_usd,
             events = events + excluded.events`,
          bucket.exchange,
          bucket.symbol,
          bucket.bucketTs,
          bucket.longUsd,
          bucket.shortUsd,
          bucket.events,
        );
      }
    } catch (error) {
      for (const bucket of snapshot) this.mergeBack(bucket);
      throw error;
    } finally {
      this.flushing = false;
    }
  }

  private mergeBack(next: PendingBucket): void {
    const key = `${next.exchange}|${next.symbol}|${next.bucketTs}`;
    const current = this.pending.get(key);
    if (!current) {
      this.pending.set(key, next);
      return;
    }
    current.longUsd += next.longUsd;
    current.shortUsd += next.shortUsd;
    current.events += next.events;
  }

  private buildSummary(symbol: string) {
    const now = Date.now();
    const cutoff24h = now - 24 * 60 * 60 * 1000;
    const rows = Array.from(
      this.sql.exec<BucketRow>(
        `SELECT exchange, symbol, bucket_ts, long_usd, short_usd, events
         FROM liquidation_buckets
         WHERE symbol = ? AND bucket_ts >= ?
         ORDER BY bucket_ts ASC`,
        symbol,
        cutoff24h - BUCKET_MS,
      ),
    );

    const pending = [...this.pending.values()].filter(
      (bucket) => bucket.symbol === symbol && bucket.bucketTs >= cutoff24h - BUCKET_MS,
    );
    const allRows: BucketRow[] = [
      ...rows,
      ...pending.map((bucket) => ({
        exchange: bucket.exchange,
        symbol: bucket.symbol,
        bucket_ts: bucket.bucketTs,
        long_usd: bucket.longUsd,
        short_usd: bucket.shortUsd,
        events: bucket.events,
      })),
    ];

    const windows = Object.fromEntries(
      WINDOWS.map((hours) => {
        const cutoff = now - hours * 60 * 60 * 1000;
        let longUsd = 0;
        let shortUsd = 0;
        let events = 0;
        const byExchange: Record<string, { longUsd: number; shortUsd: number; totalUsd: number; events: number }> = {};

        for (const row of allRows) {
          if (row.bucket_ts < cutoff) continue;
          longUsd += Number(row.long_usd) || 0;
          shortUsd += Number(row.short_usd) || 0;
          events += Number(row.events) || 0;
          const exchange = byExchange[row.exchange] ?? { longUsd: 0, shortUsd: 0, totalUsd: 0, events: 0 };
          exchange.longUsd += Number(row.long_usd) || 0;
          exchange.shortUsd += Number(row.short_usd) || 0;
          exchange.totalUsd = exchange.longUsd + exchange.shortUsd;
          exchange.events += Number(row.events) || 0;
          byExchange[row.exchange] = exchange;
        }

        return [
          `${hours}h`,
          {
            longUsd,
            shortUsd,
            totalUsd: longUsd + shortUsd,
            events,
            byExchange,
          },
        ];
      }),
    );

    const firstStored = Array.from(
      this.sql.exec<{ first_ts: number | null }>(
        `SELECT MIN(bucket_ts) AS first_ts FROM liquidation_buckets WHERE symbol = ?`,
        symbol,
      ),
    )[0]?.first_ts;

    return {
      generatedAt: now,
      symbol,
      bucketSizeMs: BUCKET_MS,
      coverageStart: firstStored ?? null,
      windows,
      collector: {
        symbols: [...this.symbols],
        exchanges: this.serializedExchangeState(),
      },
    };
  }

  private storageStats() {
    const row = Array.from(
      this.sql.exec<{ rows: number; first_ts: number | null; last_ts: number | null }>(
        `SELECT COUNT(*) AS rows, MIN(bucket_ts) AS first_ts, MAX(bucket_ts) AS last_ts
         FROM liquidation_buckets`,
      ),
    )[0];
    return {
      rows: Number(row?.rows ?? 0),
      firstBucketAt: row?.first_ts ?? null,
      lastBucketAt: row?.last_ts ?? null,
    };
  }

  private pruneOldRows(): void {
    this.sql.exec(`DELETE FROM liquidation_buckets WHERE bucket_ts < ?`, Date.now() - RETENTION_MS);
  }

  private pruneFingerprints(): void {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of this.fingerprints) if (ts < cutoff) this.fingerprints.delete(key);
  }

  private serializedExchangeState() {
    return Object.fromEntries(this.exchangeState.entries());
  }
}

function parseBinanceLiquidations(raw: unknown): Liquidation[] {
  const decoded = decodeJson(raw);
  const entries = Array.isArray(decoded) ? decoded : [decoded];
  const result: Liquidation[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const event = isRecord(entry.data) ? entry.data : entry;
    const order = isRecord(event.o) ? event.o : null;
    if (!order || typeof order.s !== "string") continue;
    const symbol = normalizeSymbol(order.s);
    if (!symbol.endsWith("USDT")) continue;
    const price = Number(order.ap || order.p);
    const qty = Number(order.z || order.q);
    const ts = Number(order.T ?? event.E ?? Date.now());
    if (!positiveFinite(price) || !positiveFinite(qty) || !Number.isFinite(ts)) continue;
    result.push({
      exchange: "binance",
      symbol,
      ts,
      side: order.S === "SELL" ? "long" : "short",
      price,
      qty,
      notional: price * qty,
    });
  }
  return result;
}

function parseBybitLiquidations(raw: unknown): Liquidation[] {
  const payload = decodeJson(raw);
  if (!isRecord(payload)) return [];
  const topic = typeof payload.topic === "string" ? payload.topic : "";
  if (!topic.startsWith("allLiquidation.")) return [];
  const values = Array.isArray(payload.data) ? payload.data : [payload.data];

  return values.flatMap((value) => {
    if (!isRecord(value) || typeof value.s !== "string") return [];
    const symbol = normalizeSymbol(value.s);
    const price = Number(value.p);
    const qty = Number(value.v);
    const ts = Number(value.T ?? payload.ts ?? Date.now());
    if (!symbol.endsWith("USDT") || !positiveFinite(price) || !positiveFinite(qty) || !Number.isFinite(ts)) return [];
    return [{
      exchange: "bybit" as const,
      symbol,
      ts,
      side: value.S === "Buy" ? ("long" as const) : ("short" as const),
      price,
      qty,
      notional: price * qty,
    }];
  });
}

function decodeJson(raw: unknown): unknown {
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(raw));
  return raw;
}

function liquidationFingerprint(item: Liquidation): string {
  return `${item.exchange}|${item.symbol}|${item.ts}|${item.side}|${item.price}|${item.qty}`;
}

function parseSymbols(value?: string): string[] {
  const symbols = (value ?? DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map(normalizeSymbol)
    .filter((symbol) => symbol.endsWith("USDT"));
  return symbols.length ? [...new Set(symbols)] : DEFAULT_SYMBOLS;
}

function normalizeSymbol(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function freshExchangeState(): ExchangeState {
  return {
    connected: false,
    connecting: false,
    lastMessageAt: null,
    lastLiquidationAt: null,
    lastError: null,
    reconnects: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "Error desconocido";
}

function cors(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", env.CORS_ORIGIN || "*");
  headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
