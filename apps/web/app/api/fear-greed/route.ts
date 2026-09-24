import { NextResponse } from "next/server";
import { parseFearGreedResponse } from "../../../lib/market/fear-greed";

const FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1&format=json";

export async function GET() {
  try {
    const response = await fetch(FEAR_GREED_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`Alternative.me respondió ${response.status}`);
    const reading = parseFearGreedResponse(await response.json());
    return NextResponse.json(reading, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Índice no disponible" },
      { status: 502 },
    );
  }
}
