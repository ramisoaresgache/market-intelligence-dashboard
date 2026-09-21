import collectorHandler, { LiquidationCollector } from "./index";
import { BinanceRegionProbe } from "./binance-region-probe";

export { BinanceRegionProbe, LiquidationCollector };

type Env = {
  LIQUIDATION_COLLECTOR: DurableObjectNamespace;
  BINANCE_REGION_PROBE: DurableObjectNamespace;
  COLLECTOR_SYMBOLS?: string;
  CORS_ORIGIN?: string;
};

type RegionHint = "weur" | "apac" | "wnam";

const PROBE_GENERATION = "2026-09-21-v1";
const REGION_PROBES: Array<{ hint: RegionHint; label: string }> = [
  { hint: "weur", label: "Western Europe" },
  { hint: "apac", label: "Asia-Pacific" },
  { hint: "wnam", label: "Western North America" },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v1/diagnostics/binance-regions") {
      return withCors(await runBinanceRegionDiagnostics(env), env);
    }

    return collectorHandler.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;

async function runBinanceRegionDiagnostics(env: Env): Promise<Response> {
  const [primary, regions] = await Promise.all([
    fetchPrimaryDiagnostic(env),
    Promise.all(REGION_PROBES.map((region) => runRegionProbe(env, region))),
  ]);

  return Response.json({
    generatedAt: Date.now(),
    probeGeneration: PROBE_GENERATION,
    note: "Cloudflare locationHint is best-effort and only affects first creation of each named Durable Object.",
    primary,
    regions,
  });
}

async function fetchPrimaryDiagnostic(env: Env): Promise<unknown> {
  try {
    const stub = env.LIQUIDATION_COLLECTOR.getByName("primary");
    const response = await stub.fetch(new Request("https://collector.internal/v1/diagnostics/binance"));
    return await response.json();
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function runRegionProbe(
  env: Env,
  region: { hint: RegionHint; label: string },
): Promise<Record<string, unknown>> {
  const objectName = `binance-region-probe-${region.hint}-${PROBE_GENERATION}`;

  try {
    const stub = env.BINANCE_REGION_PROBE.getByName(objectName, { locationHint: region.hint });
    const response = await stub.fetch(new Request("https://binance-probe.internal/probe"));
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      hint: region.hint,
      label: region.label,
      objectName,
      ...payload,
    };
  } catch (error) {
    return {
      hint: region.hint,
      label: region.label,
      objectName,
      error: errorMessage(error),
    };
  }
}

function withCors(response: Response, env: Env): Response {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "Error desconocido";
}
