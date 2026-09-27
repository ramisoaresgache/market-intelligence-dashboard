import { DurableObject } from "cloudflare:workers";

const BINANCE_REST_PING = "https://fapi.binance.com/fapi/v1/ping";
const BINANCE_WS_PROBE = "https://fstream.binance.com/market/ws";

type ProbeResult = {
  ok: boolean;
  status: number | null;
  statusText: string | null;
  body: string | null;
  elapsedMs: number;
  error: string | null;
};

export class BinanceRegionProbe extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/probe") {
      return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
    }

    const [rest, websocket] = await Promise.all([probeRest(), probeWebSocket()]);

    return Response.json({
      generatedAt: Date.now(),
      probeName: this.ctx.id.name ?? null,
      jurisdiction: this.ctx.id.jurisdiction ?? null,
      rest,
      websocket,
    });
  }
}

async function probeRest(): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(BINANCE_REST_PING, {
      method: "GET",
      headers: { "Cache-Control": "no-cache" },
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || null,
      body: await responseSnippet(response),
      elapsedMs: Date.now() - startedAt,
      error: response.ok ? null : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      body: null,
      elapsedMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

async function probeWebSocket(): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(BINANCE_WS_PROBE, {
      headers: {
        Upgrade: "websocket",
        "Cache-Control": "no-cache",
      },
    });

    const socket = response.webSocket;
    if (socket) {
      socket.accept();
      socket.close(1000, "regional probe complete");
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText || null,
        body: null,
        elapsedMs: Date.now() - startedAt,
        error: null,
      };
    }

    return {
      ok: false,
      status: response.status,
      statusText: response.statusText || null,
      body: await responseSnippet(response),
      elapsedMs: Date.now() - startedAt,
      error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      body: null,
      elapsedMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

async function responseSnippet(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "Error desconocido";
}
