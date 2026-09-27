import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FeedSource = {
  name: string;
  url: string;
  publisher?: string;
};

type NewsArticle = {
  url: string;
  title: string;
  publishedAt: string | null;
  domain: string;
  sourceCountry: string;
  image: null;
  language: "Spanish";
};

const feeds: FeedSource[] = [
  { name: "CriptoNoticias", url: "https://www.criptonoticias.com/feed/", publisher: "CriptoNoticias" },
  { name: "Google Noticias", url: "https://news.google.com/rss/search?q=bitcoin%20OR%20ethereum%20OR%20criptomonedas%20OR%20blockchain%20when%3A7d&hl=es-419&gl=AR&ceid=AR%3Aes-419" },
];

export async function GET() {
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const availableSources = results.flatMap((result, index) => result.status === "fulfilled" ? [feeds[index].name] : []);
  const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${feeds[index].name}: ${errorMessage(result.reason)}`] : []);
  const seen = new Set<string>();
  const articles = results
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt))
    .filter((article) => {
      const key = article.title.toLocaleLowerCase("es").replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);

  if (!availableSources.length) {
    return NextResponse.json(
      { state: "unavailable", fetchedAt: new Date().toISOString(), articles: [], sources: [], error: errors.join(" · ") || "Las fuentes RSS no respondieron" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { state: "live", fetchedAt: new Date().toISOString(), articles, sources: availableSources, partial: errors.length > 0 },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
  );
}

async function fetchFeed(source: FeedSource): Promise<NewsArticle[]> {
  const response = await fetch(source.url, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      "User-Agent": "MarketIntelligenceDashboard/1.0 (+public RSS reader)",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1];
    const title = cleanXml(tag(item, "title"));
    const url = safeHttpUrl(cleanXml(tag(item, "link")));
    if (!title || !url || isLowSignalHeadline(title)) return [];
    const sourceName = source.publisher || cleanXml(tag(item, "source")) || hostname(url);
    return [{
      url,
      title,
      publishedAt: isoDate(cleanXml(tag(item, "pubDate"))),
      domain: sourceName,
      sourceCountry: "",
      image: null,
      language: "Spanish" as const,
    }];
  });
}

function isLowSignalHeadline(title: string): boolean {
  return /cotizaci[oó]n (?:actual|de)|cu[aá]nto vale hoy|precio del bitcoin hoy: actualizaci[oó]n|c[oó]mo ha cambiado el valor|\b1win\b|casino/i.test(title);
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1] ?? "";
}

function cleanXml(value: string): string {
  return decodeEntities(value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Fuente RSS";
  }
}

function isoDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}
