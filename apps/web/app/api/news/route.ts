import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  sourcecountry?: unknown;
  socialimage?: unknown;
  language?: unknown;
};

export async function GET() {
  const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  endpoint.searchParams.set("query", '(bitcoin OR ethereum OR criptomonedas OR blockchain OR "Reserva Federal" OR inflación OR Nasdaq) sourcelang:Spanish');
  endpoint.searchParams.set("mode", "ArtList");
  endpoint.searchParams.set("maxrecords", "50");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("sort", "DateDesc");
  endpoint.searchParams.set("timespan", "1week");

  try {
    const response = await fetch(endpoint, { next: { revalidate: 300 }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`GDELT respondió ${response.status}`);
    const payload = await response.json() as { articles?: GdeltArticle[] };
    const seen = new Set<string>();
    const articles = (payload.articles ?? []).flatMap((article) => {
      const url = validUrl(article.url);
      const title = text(article.title);
      if (!url || !title || !isRelevantHeadline(title)) return [];
      const key = `${title.toLocaleLowerCase("es")}|${url}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        url,
        title,
        publishedAt: gdeltDate(article.seendate),
        domain: text(article.domain) || new URL(url).hostname.replace(/^www\./, ""),
        sourceCountry: text(article.sourcecountry),
        image: validUrl(article.socialimage),
        language: text(article.language),
      }];
    });

    return NextResponse.json(
      { state: "live", fetchedAt: new Date().toISOString(), articles },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    return NextResponse.json(
      { state: "unavailable", fetchedAt: new Date().toISOString(), articles: [], error: error instanceof Error ? error.message : "No se pudo consultar GDELT" },
      { status: 502 },
    );
  }
}

function isRelevantHeadline(title: string): boolean {
  return /bitcoin|bitc[oó]in|ethereum|criptomoneda|\bcripto\b|blockchain|stablecoin|\btoken(?:es|s)?\b|binance|coinbase|\betf\b|reserva federal|\bfed\b|tasas? de inter[eé]s|inflaci[oó]n|\bipc\b|d[oó]lar|empleo|\bpib\b|arancel|wall street|nasdaq/i.test(title);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function gdeltDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}
