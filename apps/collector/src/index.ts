import { DurableObject } from "cloudflare:workers";

const BINANCE_ENDPOINTS = [
  { id: "market-dynamic", url: "https://fstream.binance.com/market/ws" },
  { id: "market-stream", url: "https://fstream.binance.com/market/stream?streams=!forceOrder@arr" },
  { id: "market-raw", url: "https://fstream.binance.com/market/ws/!forceOrder@arr" },
] as const;
const BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";
const BITMEX_WS = "wss://ws.bitmex.com/realtime?subscribe=liquidation";
const GATE_WS = "wss://fx-ws.gateio.ws/v4/ws/usdt";
const GATE_API = "https://api.gateio.ws/api/v4";
const BUCKET_MS = 60_000;
const ALARM_MS = 60_000;
const RETENTION_MS = 72 * 60 * 60 * 1000;
const HEARTBEAT_MS = 20_000;
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "BCHUSDT",
];
const WINDOWS = [1, 4, 12, 24] as const;

type Side = "long" | "short";
type ActiveExchange = "bybit" | "bitmex" | "gate";
type ExchangeKey = "binance" | ActiveExchange;

type Env = {
  LIQUIDATION_COLLECTOR: DurableObjectNamespace;
  COLLECTOR_SYMBOLS?: string;
  CORS_ORIGIN?: string;
};

type Liquidation = {
  exchange: ActiveExchange;
  symbol: string;
  ts: number;
  side: Side;
  price: number;
  qty: number;
  notional: number;
};

type PendingBucket = {
  exchange: ActiveExchange;
  symbol: string;
  bucketTs: number;
  longUsd: number;
  shortUsd: number;
  events: number;
};

type BucketRow = {
  exchange: string;
  symbol: string;
  bucket_ts: number;
  long_usd: number;
  short_usd: number;
  events: number;
};

type ExchangeState = {
  enabled: boolean;
  detail: string | null;
  connected: boolean;
  connecting: boolean;
  endpoint: string | null;
  transport: string | null;
  lastOpenedAt: number | null;
  lastClosedAt: number | null;
  closeCode: number | null;
  closeReason: string | null;
  lastMessageAt: number | null;
  lastLiquidationAt: number | null;
  lastError: string | null;
  reconnects: number;
  lastHandshakeAt: number | null;
  handshakeStatus: number | null;
  handshakeStatusText: string | null;
  handshakeBody: string | null;
  lastRestCheckAt: number | null;
  restReachable: boolean | null;
  restStatus: number | null;
  restStatusText: string | null;
  restError: string | null;
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
            "/v1/diagnostics/binance",
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
  private readonly sockets = new Map<ActiveExchange, WebSocket>();
  private readonly exchangeState = new Map<ExchangeKey, ExchangeState>();
  private readonly heartbeats = new Map<ActiveExchange, ReturnType<typeof setInterval>>();
  private readonly gateMultipliers = new Map<string, number>();
  private gateMultiplierLoad: Promise<void> | null = null;
  private flushing = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.symbols = new Set(parseSymbols(env.COLLECTOR_SYMBOLS));

    const binance = freshExchangeState(false);
    binance.endpoint = "disabled";
    binance.detail =
      "Desactivado para recolección activa: Binance devolvió HTTP 403 desde el collector y probes de Western Europe, Asia-Pacific y Western North America.";
    this.exchangeState.set("binance", binance);
    this.exchangeState.set("bybit", freshExchangeState());
    this.exchangeState.set("bitmex", freshExchangeState());
    this.exchangeState.set("gate", freshExchangeState());

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
        activeExchanges: ["bybit", "gate", "bitmex"],
        exchanges: this.serializedExchangeState(),
      });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        generatedAt: Date.now(),
        symbols: [...this.symbols],
        activeExchanges: ["bybit", "gate", "bitmex"],
        pendingBuckets: this.pending.size,
        retentionMs: RETENTION_MS,
        exchanges: this.serializedExchangeState(),
        storage: this.storageStats(),
      });
    }

    if (url.pathname === "/v1/diagnostics/binance") {
      return Response.json({
        generatedAt: Date.now(),
        collectionEnabled: false,
        reason: this.exchangeState.get("binance")?.detail,
        endpointCandidates: BINANCE_ENDPOINTS,
        state: this.exchangeState.get("binance"),
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
    this.ensureBybit();
    this.ensureBitmex();
    await this.ensureGate();
    await this.scheduleAlarm();
  }

  private ensureBybit(): void {
    if (!this.canConnect("bybit")) return;
    const state = this.exchangeState.get("bybit")!;
    state.connecting = true;
    state.endpoint = "linear";
    state.transport = "constructor";

    const socket = new WebSocket(BYBIT_WS);
    this.attachSocket("bybit", socket, () => {
      socket.send(
        JSON.stringify({
          op: "subscribe",
          args: [...this.symbols].map((symbol) => `allLiquidation.${symbol}`),
        }),
      );
      this.startHeartbeat("bybit", socket, () => JSON.stringify({ op: "ping" }));
    }, (raw) => parseBybitLiquidations(raw));
  }

  private ensureBitmex(): void {
    if (!this.canConnect("bitmex")) return;
    const state = this.exchangeState.get("bitmex")!;
    state.connecting = true;
    state.endpoint = "liquidation";
    state.transport = "constructor";

    const socket = new WebSocket(BITMEX_WS);
    this.attachSocket("bitmex", socket, undefined, (raw) => parseBitmexLiquidations(raw));
  }

  private async ensureGate(): Promise<void> {
    if (!this.canConnect("gate")) return;
    const state = this.exchangeState.get("gate")!;
    state.connecting = true;
    state.endpoint = "futures.public_liquidates";
    state.transport = "constructor";

    try {
      await this.ensureGateMultipliers();
      if (!this.gateMultipliers.size) {
        state.connecting = false;
        state.lastError = "Gate: no se pudieron cargar multiplicadores de contratos";
        state.reconnects += 1;
        await this.scheduleReconnect();
        return;
      }

      const socket = new WebSocket(GATE_WS);
      this.attachSocket(
        "gate",
        socket,
        () => {
          socket.send(
            JSON.stringify({
              time: Math.floor(Date.now() / 1000),
              channel: "futures.public_liquidates",
              event: "subscribe",
              payload: ["!all"],
            }),
          );
          this.startHeartbeat("gate", socket, () =>
            JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" }),
          );
        },
        (raw) => parseGateLiquidations(raw, this.gateMultipliers),
      );
    } catch (error) {
      state.connecting = false;
      state.connected = false;
      state.lastError = `Gate: ${errorMessage(error)}`;
      state.reconnects += 1;
      await this.scheduleReconnect();
    }
  }

  private canConnect(exchange: ActiveExchange): boolean {
    const socket = this.sockets.get(exchange);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return false;
    return !this.exchangeState.get(exchange)?.connecting;
  }

  private attachSocket(
    exchange: ActiveExchange,
    socket: WebSocket,
    onOpen: (() => void) | undefined,
    parse: (raw: unknown) => Liquidation[],
  ): void {
    const state = this.exchangeState.get(exchange)!;
    this.sockets.set(exchange, socket);

    socket.addEventListener("open", () => {
      state.connected = true;
      state.connecting = false;
      state.lastOpenedAt = Date.now();
      state.closeCode = null;
      state.closeReason = null;
      state.lastError = null;
      onOpen?.();
    });

    socket.addEventListener("message", (event) => {
      state.lastMessageAt = Date.now();
      try {
        const liquidations = parse(event.data);
        for (const liquidation of liquidations) this.record(liquidation);
        if (liquidations.length > 0) {
          state.lastLiquidationAt = Math.max(...liquidations.map((liquidation) => liquidation.ts));
        }
        state.connected = true;
      } catch (error) {
        state.lastError = errorMessage(error);
      }
    });

    socket.addEventListener("error", () => {
      state.lastError = `Error de WebSocket ${exchange}`;
    });

    socket.addEventListener("close", (event) => {
      if (this.sockets.get(exchange) === socket) this.sockets.delete(exchange);
      this.stopHeartbeat(exchange);
      state.connected = false;
      state.connecting = false;
      state.lastClosedAt = Date.now();
      state.closeCode = event.code;
      state.closeReason = event.reason || null;
      if (event.code !== 1000) {
        state.lastError = `${exchange} cerró WebSocket (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`;
      }
      state.reconnects += 1;
      this.ctx.waitUntil(this.scheduleReconnect());
    });
  }

  private startHeartbeat(exchange: ActiveExchange, socket: WebSocket, payload: () => string): void {
    this.stopHeartbeat(exchange);
    const timer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload());
    }, HEARTBEAT_MS);
    this.heartbeats.set(exchange, timer);
  }

  private stopHeartbeat(exchange: ActiveExchange): void {
    const timer = this.heartbeats.get(exchange);
    if (timer !== undefined) clearInterval(timer);
    this.heartbeats.delete(exchange);
  }

  private async ensureGateMultipliers(): Promise<void> {
    if (this.gateMultipliers.size >= this.symbols.size) return;
    if (this.gateMultiplierLoad) return this.gateMultiplierLoad;

    this.gateMultiplierLoad = Promise.allSettled(
      [...this.symbols].map(async (symbol) => {
        const contract = toGateContract(symbol);
        const response = await fetch(`${GATE_API}/futures/usdt/contracts/${contract}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`${contract} HTTP ${response.status}`);
        const payload = (await response.json()) as { quanto_multiplier?: string };
        const multiplier = Number(payload.quanto_multiplier);
        if (Number.isFinite(multiplier) && multiplier > 0) this.gateMultipliers.set(symbol, multiplier);
      }),
    ).then(() => undefined).finally(() => {
      this.gateMultiplierLoad = null;
    });

    return this.gateMultiplierLoad;
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

        return [`${hours}h`, { longUsd, shortUsd, totalUsd: longUsd + shortUsd, events, byExchange }];
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
      retentionMs: RETENTION_MS,
      coverageStart: firstStored ?? null,
      windows,
      collector: {
        symbols: [...this.symbols],
        activeExchanges: ["bybit", "gate", "bitmex"],
        exchanges: this.serializedExchangeState(),
      },
    };
  }

  private storageStats() {
    const row = Array.from(
      this.sql.exec<{ rows: number; first_ts: number | null; last_ts: number | null }>(
        `SELECT COUNT(*) AS rows, MIN(bucket_ts) AS first_ts, MAX(bucket_ts) AS last_ts FROM liquidation_buckets`,
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

function parseBitmexLiquidations(raw: unknown): Liquidation[] {
  const payload = decodeJson(raw);
  if (!isRecord(payload) || payload.table !== "liquidation" || payload.action !== "insert") return [];
  const rows = Array.isArray(payload.data) ? payload.data : [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || row.symbol !== "XBTUSD") return [];
    const price = Number(row.price);
    const qty = Math.abs(Number(row.leavesQty));
    if (!positiveFinite(price) || !positiveFinite(qty)) return [];
    return [{
      exchange: "bitmex" as const,
      symbol: "BTCUSDT",
      ts: Date.now(),
      side: row.side === "Sell" ? ("long" as const) : ("short" as const),
      price,
      qty,
      notional: qty,
    }];
  });
}

function parseGateLiquidations(raw: unknown, multipliers: Map<string, number>): Liquidation[] {
  const payload = decodeJson(raw);
  if (!isRecord(payload) || payload.channel !== "futures.public_liquidates" || payload.event !== "update") return [];
  const rows = Array.isArray(payload.result) ? payload.result : [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.contract !== "string") return [];
    const symbol = normalizeSymbol(row.contract);
    const price = Number(row.price);
    const signedSize = Number(row.size);
    const qty = Math.abs(signedSize);
    const multiplier = multipliers.get(symbol);
    const rawTs = Number(row.time ?? payload.time_ms ?? Date.now());
    const ts = rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs;
    if (!positiveFinite(price) || !positiveFinite(qty) || !positiveFinite(multiplier ?? 0) || !Number.isFinite(ts)) return [];
    const baseQty = qty * (multiplier ?? 0);
    return [{
      exchange: "gate" as const,
      symbol,
      ts,
      side: signedSize < 0 ? ("long" as const) : ("short" as const),
      price,
      qty: baseQty,
      notional: baseQty * price,
    }];
  });
}

function toGateContract(symbol: string): string {
  return `${symbol.slice(0, -4)}_USDT`;
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

function freshExchangeState(enabled = true): ExchangeState {
  return {
    enabled,
    detail: null,
    connected: false,
    connecting: false,
    endpoint: null,
    transport: null,
    lastOpenedAt: null,
    lastClosedAt: null,
    closeCode: null,
    closeReason: null,
    lastMessageAt: null,
    lastLiquidationAt: null,
    lastError: null,
    reconnects: 0,
    lastHandshakeAt: null,
    handshakeStatus: null,
    handshakeStatusText: null,
    handshakeBody: null,
    lastRestCheckAt: null,
    restReachable: null,
    restStatus: null,
    restStatusText: null,
    restError: null,
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
