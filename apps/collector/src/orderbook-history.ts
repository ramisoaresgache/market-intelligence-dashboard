import { DurableObject } from "cloudflare:workers";

const SNAPSHOT_MS = 60_000;
const RETENTION_MS = 48 * 60 * 60 * 1000;
const DEPTH_LIMIT = 30;
const MAX_HISTORY_HOURS = 48;
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
const CENTRAL_SOURCES = ["bybit", "okx", "mexc", "whitebit", "bitunix"] as const;

const BYBIT_API = "https://api.bybit.com";
const OKX_API = "https://www.okx.com";
const MEXC_API = "https://contract.mexc.com";
const WHITEBIT_API = "https://whitebit.com";
const BITUNIX_API = "https://fapi.bitunix.com";

type OrderBookSource = (typeof CENTRAL_SOURCES)[number];
type ExchangeFilter = "all" | OrderBookSource | "binance" | "bingx";
type Level = [price: number, notional: number];

type Env = {
  ORDERBOOK_COLLECTOR: DurableObjectNamespace;
  COLLECTOR_SYMBOLS?: string;
  CORS_ORIGIN?: string;
};

type StoredBook = {
  ts: number;
  bids: Level[];
  asks: Level[];
};

type StoredSnapshot = {
  sources: Partial<Record<OrderBookSource, StoredBook>>;
};

type SnapshotRow = {
  symbol: string;
  bucket_ts: number;
  payload_json: string;
};

type LiquidityLevel = {
  price: number;
  bidNotional: number;
  askNotional: number;
};

type LiquidityFrame = {
  symbol: string;
  ts: number;
  midpoint: number;
  bucketSize: number;
  levels: LiquidityLevel[];
};

type SourceHealth = {
  successes: number;
  failures: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
};

export class OrderBookCollector extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly symbols: Set<string>;
  private readonly sourceHealth = new Map<OrderBookSource, SourceHealth>();
  private readonly okxContractValues = new Map<string, number>();
  private readonly mexcContractSizes = new Map<string, number>();
  private metadataPromise: Promise<void> | null = null;
  private collecting = false;
  private lastCollectionAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.symbols = new Set(parseSymbols(env.COLLECTOR_SYMBOLS));
    for (const source of CENTRAL_SOURCES) this.sourceHealth.set(source, freshSourceHealth());

    ctx.blockConcurrencyWhile(async () => {
      this.initializeSchema();
      await this.scheduleAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.ensureFreshCollection();

    if (url.pathname === "/v1/orderbook/health") {
      return Response.json({
        ok: true,
        generatedAt: Date.now(),
        symbols: [...this.symbols],
        storageResolutionMs: SNAPSHOT_MS,
        retentionMs: RETENTION_MS,
        centralSources: [...CENTRAL_SOURCES],
        browserOnlySources: ["binance", "bingx"],
        lastCollectionAt: this.lastCollectionAt,
        sources: Object.fromEntries(this.sourceHealth.entries()),
        storage: this.storageStats(),
      });
    }

    if (url.pathname === "/v1/orderbook/symbols") {
      return Response.json({ symbols: [...this.symbols] });
    }

    if (url.pathname === "/v1/orderbook/history") {
      const symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
      if (!this.symbols.has(symbol)) {
        return Response.json(
          { error: `Símbolo no recolectado: ${symbol}`, supportedSymbols: [...this.symbols] },
          { status: 404 },
        );
      }

      const exchange = normalizeExchange(url.searchParams.get("exchange"));
      const hours = clampNumber(Number(url.searchParams.get("hours") ?? 4), 0.25, MAX_HISTORY_HOURS);
      return Response.json(this.buildHistory(symbol, exchange, hours));
    }

    return Response.json({ error: "Ruta de order book no encontrada" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.collectMinute();
    this.pruneOldRows();
    await this.scheduleAlarm();
  }

  private initializeSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS orderbook_snapshots (
        symbol TEXT NOT NULL,
        bucket_ts INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (symbol, bucket_ts)
      );
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_orderbook_snapshots_symbol_ts
      ON orderbook_snapshots(symbol, bucket_ts);
    `);
  }

  private async scheduleAlarm(): Promise<void> {
    const nextMinute = Math.floor(Date.now() / SNAPSHOT_MS) * SNAPSHOT_MS + SNAPSHOT_MS + 1_500;
    const current = await this.ctx.storage.getAlarm();
    if (current == null || Math.abs(current - nextMinute) > 5_000) {
      await this.ctx.storage.setAlarm(nextMinute);
    }
  }

  private ensureFreshCollection(): void {
    if (this.collecting) return;
    if (this.lastCollectionAt !== null && Date.now() - this.lastCollectionAt < SNAPSHOT_MS * 1.5) return;
    this.ctx.waitUntil(this.collectMinute());
  }

  private async collectMinute(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;

    try {
      await this.ensureContractMetadata();
      const bucketTs = Math.floor(Date.now() / SNAPSHOT_MS) * SNAPSHOT_MS;

      await Promise.all(
        [...this.symbols].map(async (symbol) => {
          const results = await Promise.allSettled(
            CENTRAL_SOURCES.map(async (source) => [source, await this.fetchBook(source, symbol)] as const),
          );
          const sources: StoredSnapshot["sources"] = {};

          results.forEach((result, index) => {
            const source = CENTRAL_SOURCES[index] as OrderBookSource;
            if (result.status === "fulfilled") {
              const [, book] = result.value;
              sources[source] = book;
              this.markSourceSuccess(source);
            } else {
              this.markSourceFailure(source, result.reason);
            }
          });

          if (Object.keys(sources).length === 0) return;
          this.sql.exec(
            `INSERT INTO orderbook_snapshots (symbol, bucket_ts, payload_json)
             VALUES (?, ?, ?)
             ON CONFLICT(symbol, bucket_ts) DO UPDATE SET payload_json = excluded.payload_json`,
            symbol,
            bucketTs,
            JSON.stringify({ sources } satisfies StoredSnapshot),
          );
        }),
      );

      this.lastCollectionAt = Date.now();
    } finally {
      this.collecting = false;
    }
  }

  private async ensureContractMetadata(): Promise<void> {
    if (
      this.okxContractValues.size >= this.symbols.size &&
      this.mexcContractSizes.size >= this.symbols.size
    ) {
      return;
    }
    if (this.metadataPromise) return this.metadataPromise;

    this.metadataPromise = Promise.allSettled([
      this.loadOkxContractValues(),
      this.loadMexcContractSizes(),
    ]).then(() => undefined).finally(() => {
      this.metadataPromise = null;
    });
    return this.metadataPromise;
  }

  private async loadOkxContractValues(): Promise<void> {
    const payload = await fetchJson(`${OKX_API}/api/v5/public/instruments?instType=SWAP`);
    if (!isRecord(payload) || !Array.isArray(payload.data)) return;
    for (const item of payload.data) {
      if (!isRecord(item) || typeof item.instId !== "string") continue;
      if (!item.instId.endsWith("-USDT-SWAP")) continue;
      const symbol = normalizeSymbol(item.instId.replace("-SWAP", ""));
      const value = Number(item.ctVal);
      if (this.symbols.has(symbol) && positiveFinite(value)) this.okxContractValues.set(symbol, value);
    }
  }

  private async loadMexcContractSizes(): Promise<void> {
    const payload = await fetchJson(`${MEXC_API}/api/v1/contract/detail`);
    if (!isRecord(payload) || !Array.isArray(payload.data)) return;
    for (const item of payload.data) {
      if (!isRecord(item) || typeof item.symbol !== "string") continue;
      const symbol = normalizeSymbol(item.symbol);
      const size = Number(item.contractSize);
      if (this.symbols.has(symbol) && positiveFinite(size)) this.mexcContractSizes.set(symbol, size);
    }
  }

  private async fetchBook(source: OrderBookSource, symbol: string): Promise<StoredBook> {
    if (source === "bybit") return this.fetchBybit(symbol);
    if (source === "okx") return this.fetchOkx(symbol);
    if (source === "mexc") return this.fetchMexc(symbol);
    if (source === "whitebit") return this.fetchWhitebit(symbol);
    return this.fetchBitunix(symbol);
  }

  private async fetchBybit(symbol: string): Promise<StoredBook> {
    const params = new URLSearchParams({ category: "linear", symbol, limit: String(DEPTH_LIMIT) });
    const payload = await fetchJson(`${BYBIT_API}/v5/market/orderbook?${params}`);
    if (!isRecord(payload) || Number(payload.retCode) !== 0 || !isRecord(payload.result)) {
      throw new Error("Bybit order book inválido");
    }
    const bids = parseArrayLevels(payload.result.b, 1);
    const asks = parseArrayLevels(payload.result.a, 1);
    return requireBook("Bybit", Number(payload.result.ts ?? Date.now()), bids, asks);
  }

  private async fetchOkx(symbol: string): Promise<StoredBook> {
    const multiplier = this.okxContractValues.get(symbol);
    if (!positiveFinite(multiplier ?? 0)) throw new Error(`OKX sin ctVal para ${symbol}`);
    const instId = `${symbol.slice(0, -4)}-USDT-SWAP`;
    const params = new URLSearchParams({ instId, sz: String(DEPTH_LIMIT) });
    const payload = await fetchJson(`${OKX_API}/api/v5/market/books?${params}`);
    if (!isRecord(payload) || payload.code !== "0" || !Array.isArray(payload.data) || !isRecord(payload.data[0])) {
      throw new Error("OKX order book inválido");
    }
    const item = payload.data[0];
    const bids = parseArrayLevels(item.bids, multiplier ?? 1);
    const asks = parseArrayLevels(item.asks, multiplier ?? 1);
    return requireBook("OKX", Number(item.ts ?? Date.now()), bids, asks);
  }

  private async fetchMexc(symbol: string): Promise<StoredBook> {
    const multiplier = this.mexcContractSizes.get(symbol);
    if (!positiveFinite(multiplier ?? 0)) throw new Error(`MEXC sin contractSize para ${symbol}`);
    const market = `${symbol.slice(0, -4)}_USDT`;
    const payload = await fetchJson(`${MEXC_API}/api/v1/contract/depth/${market}?limit=${DEPTH_LIMIT}`);
    if (!isRecord(payload)) throw new Error("MEXC order book inválido");
    const item = isRecord(payload.data) ? payload.data : payload;
    const bids = parseArrayLevels(item.bids, multiplier ?? 1);
    const asks = parseArrayLevels(item.asks, multiplier ?? 1);
    return requireBook("MEXC", Number(item.timestamp ?? Date.now()), bids, asks);
  }

  private async fetchWhitebit(symbol: string): Promise<StoredBook> {
    const market = `${symbol.slice(0, -4)}_PERP`;
    const payload = await fetchJson(
      `${WHITEBIT_API}/api/v4/public/orderbook/${encodeURIComponent(market)}?limit=${DEPTH_LIMIT}&level=0`,
    );
    if (!isRecord(payload)) throw new Error("WhiteBIT order book inválido");
    const bids = parseArrayLevels(payload.bids, 1);
    const asks = parseArrayLevels(payload.asks, 1);
    const rawTs = Number(payload.timestamp ?? Date.now());
    const ts = rawTs < 10_000_000_000 ? rawTs * 1000 : rawTs;
    return requireBook("WhiteBIT", ts, bids, asks);
  }

  private async fetchBitunix(symbol: string): Promise<StoredBook> {
    const params = new URLSearchParams({ symbol, limit: "50" });
    const payload = await fetchJson(`${BITUNIX_API}/api/v1/futures/market/depth?${params}`);
    if (!isRecord(payload) || Number(payload.code) !== 0 || !isRecord(payload.data)) {
      throw new Error("Bitunix order book inválido");
    }
    const bids = parseArrayLevels(payload.data.bids, 1).slice(0, DEPTH_LIMIT);
    const asks = parseArrayLevels(payload.data.asks, 1).slice(0, DEPTH_LIMIT);
    return requireBook("Bitunix", Date.now(), bids, asks);
  }

  private buildHistory(symbol: string, exchange: ExchangeFilter, hours: number) {
    const now = Date.now();
    const cutoff = now - hours * 60 * 60 * 1000;
    const rows = Array.from(
      this.sql.exec<SnapshotRow>(
        `SELECT symbol, bucket_ts, payload_json
         FROM orderbook_snapshots
         WHERE symbol = ? AND bucket_ts >= ?
         ORDER BY bucket_ts ASC`,
        symbol,
        cutoff - SNAPSHOT_MS,
      ),
    );

    const frames: LiquidityFrame[] = [];
    const sourcesUsed = new Set<string>();
    for (const row of rows) {
      const snapshot = parseStoredSnapshot(row.payload_json);
      if (!snapshot) continue;
      const frame = buildLiquidityFrame(symbol, Number(row.bucket_ts), snapshot, exchange);
      if (!frame) continue;
      frames.push(frame);
      for (const source of selectedSources(snapshot, exchange)) sourcesUsed.add(source);
    }

    const firstStored = Array.from(
      this.sql.exec<{ first_ts: number | null }>(
        `SELECT MIN(bucket_ts) AS first_ts FROM orderbook_snapshots WHERE symbol = ?`,
        symbol,
      ),
    )[0]?.first_ts;

    const browserOnly = exchange === "binance" || exchange === "bingx";
    return {
      generatedAt: now,
      symbol,
      exchange,
      requestedHours: hours,
      storageResolutionMs: SNAPSHOT_MS,
      retentionMs: RETENTION_MS,
      coverageStart: firstStored ?? null,
      frames,
      sourcesUsed: [...sourcesUsed],
      centralSources: [...CENTRAL_SOURCES],
      warning: browserOnly
        ? `${exchange} se mantiene browser-side; Cloudflare no guarda histórico central de esa fuente.`
        : null,
    };
  }

  private storageStats() {
    const row = Array.from(
      this.sql.exec<{ rows: number; first_ts: number | null; last_ts: number | null }>(
        `SELECT COUNT(*) AS rows, MIN(bucket_ts) AS first_ts, MAX(bucket_ts) AS last_ts
         FROM orderbook_snapshots`,
      ),
    )[0];
    return {
      rows: Number(row?.rows ?? 0),
      firstSnapshotAt: row?.first_ts ?? null,
      lastSnapshotAt: row?.last_ts ?? null,
    };
  }

  private pruneOldRows(): void {
    this.sql.exec(`DELETE FROM orderbook_snapshots WHERE bucket_ts < ?`, Date.now() - RETENTION_MS);
  }

  private markSourceSuccess(source: OrderBookSource): void {
    const health = this.sourceHealth.get(source) ?? freshSourceHealth();
    health.successes += 1;
    health.lastSuccessAt = Date.now();
    health.lastError = null;
    this.sourceHealth.set(source, health);
  }

  private markSourceFailure(source: OrderBookSource, error: unknown): void {
    const health = this.sourceHealth.get(source) ?? freshSourceHealth();
    health.failures += 1;
    health.lastErrorAt = Date.now();
    health.lastError = errorMessage(error);
    this.sourceHealth.set(source, health);
  }
}

function parseArrayLevels(value: unknown, qtyMultiplier: number): Level[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const price = Number(entry[0]);
    const rawQty = Number(entry[1]);
    if (!positiveFinite(price) || !positiveFinite(rawQty) || !positiveFinite(qtyMultiplier)) return [];
    const qty = rawQty * qtyMultiplier;
    return [[price, price * qty] as Level];
  });
}

function requireBook(label: string, ts: number, bids: Level[], asks: Level[]): StoredBook {
  if (!bids.length || !asks.length) throw new Error(`${label}: libro vacío`);
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    bids: bids.slice(0, DEPTH_LIMIT),
    asks: asks.slice(0, DEPTH_LIMIT),
  };
}

function selectedSources(snapshot: StoredSnapshot, exchange: ExchangeFilter): OrderBookSource[] {
  if (exchange === "all") {
    return CENTRAL_SOURCES.filter((source) => snapshot.sources[source]);
  }
  if (exchange === "binance" || exchange === "bingx") return [];
  return snapshot.sources[exchange] ? [exchange] : [];
}

function buildLiquidityFrame(
  symbol: string,
  ts: number,
  snapshot: StoredSnapshot,
  exchange: ExchangeFilter,
): LiquidityFrame | null {
  const sources = selectedSources(snapshot, exchange);
  const books = sources.flatMap((source) => {
    const book = snapshot.sources[source];
    return book ? [book] : [];
  });
  if (!books.length) return null;

  const bestBids = books.flatMap((book) => book.bids.slice(0, 1).map(([price]) => price));
  const bestAsks = books.flatMap((book) => book.asks.slice(0, 1).map(([price]) => price));
  if (!bestBids.length || !bestAsks.length) return null;
  const midpoint = (Math.max(...bestBids) + Math.min(...bestAsks)) / 2;
  const bucketSize = niceBucket(midpoint, 0.00035);
  const bidBuckets = new Map<number, number>();
  const askBuckets = new Map<number, number>();

  for (const book of books) {
    for (const [price, notional] of book.bids) {
      const bucket = normalizeFloat(Math.floor(price / bucketSize) * bucketSize, bucketSize);
      bidBuckets.set(bucket, (bidBuckets.get(bucket) ?? 0) + notional);
    }
    for (const [price, notional] of book.asks) {
      const bucket = normalizeFloat(Math.ceil(price / bucketSize) * bucketSize, bucketSize);
      askBuckets.set(bucket, (askBuckets.get(bucket) ?? 0) + notional);
    }
  }

  const selectedBids = [...bidBuckets.entries()].sort((a, b) => b[0] - a[0]).slice(0, 60);
  const selectedAsks = [...askBuckets.entries()].sort((a, b) => a[0] - b[0]).slice(0, 60);
  const levels = new Map<number, LiquidityLevel>();
  for (const [price, bidNotional] of selectedBids) {
    levels.set(price, { price, bidNotional, askNotional: 0 });
  }
  for (const [price, askNotional] of selectedAsks) {
    const current = levels.get(price);
    levels.set(price, { price, bidNotional: current?.bidNotional ?? 0, askNotional });
  }

  return {
    symbol,
    ts,
    midpoint,
    bucketSize,
    levels: [...levels.values()].sort((left, right) => left.price - right.price),
  };
}

function parseStoredSnapshot(value: string): StoredSnapshot | null {
  try {
    const parsed = JSON.parse(value) as StoredSnapshot;
    return parsed && typeof parsed === "object" && parsed.sources ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "market-intelligence-dashboard/1.0" },
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response.json();
}

function freshSourceHealth(): SourceHealth {
  return {
    successes: 0,
    failures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
  };
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

function normalizeExchange(value: string | null): ExchangeFilter {
  const normalized = (value ?? "all").toLowerCase();
  if (normalized === "all" || normalized === "binance" || normalized === "bingx") return normalized;
  return CENTRAL_SOURCES.includes(normalized as OrderBookSource)
    ? (normalized as OrderBookSource)
    : "all";
}

function niceBucket(price: number, ratio: number): number {
  if (!positiveFinite(price)) return 1;
  const target = Math.max(Number.EPSILON, price * ratio);
  const exponent = Math.floor(Math.log10(target));
  const base = 10 ** exponent;
  const scaled = target / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

function normalizeFloat(value: number, bucketSize: number): number {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(bucketSize)) + 2));
  return Number(value.toFixed(decimals));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "Error desconocido";
}
