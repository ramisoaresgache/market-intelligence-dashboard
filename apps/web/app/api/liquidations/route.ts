import { NextResponse } from "next/server";
import { normalizeSymbol } from "../../../lib/market/symbols";

export const dynamic = "force-dynamic";

const DEFAULT_COLLECTOR_URL = "https://market-intelligence-dashboard.godino290.workers.dev";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let symbol: string;

  try {
    symbol = normalizeSymbol(url.searchParams.get("symbol") ?? "BTCUSDT");
  } catch {
    return NextResponse.json({ error: "Símbolo no válido" }, { status: 400 });
  }

  const baseUrl = (process.env.LIQUIDATION_COLLECTOR_URL || DEFAULT_COLLECTOR_URL).replace(/\/$/, "");

  try {
    const upstream = await fetch(
      `${baseUrl}/v1/liquidations/summary?symbol=${encodeURIComponent(symbol)}`,
      { cache: "no-store" },
    );
    const payload = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(payload, { status: upstream.status });
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo consultar el collector" },
      { status: 502 },
    );
  }
}
