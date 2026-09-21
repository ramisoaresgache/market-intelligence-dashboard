import { classifyNewsCategory, classifyNewsImpact } from "../../../lib/macro/impact";
import type { NewsItem, SourceHealth } from "../../../lib/macro/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GDELT_QUERY = [
  "bitcoin",
  "cryptocurrency",
  '"Federal Reserve"',
  "FOMC",
  "Powell",
  "inflation",
  "CPI",
  "PCE",
  "payrolls",
  "unemployment",
  "Nasdaq",
  '"S&P 500"',
  '"Treasury yields"',
].join(" OR ");
const GDELT_URL = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`(${GDELT_QUERY})`)}&mode=artlist&format=json&maxrecords=35&timespan=48h&sort=datedesc`;
const GOOGLE_NEWS_QUERY = [
  '"Federal Reserve"',
  "FOMC",
  "Powell",
  "inflation",
  "CPI",
  "PCE",
  "payrolls",
  "unemployment",
  "bitcoin",
  "cryptocurrency",
  "Nasdaq",
  '"S&P 500"',
].join(" OR ");
const GOOGLE_NEWS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(`(${GOOGLE_NEWS_QUERY}) when:2d`)}&hl=en-US&gl=US&ceid=US:en`;
const FETCH_TIMEOUT_MS = 8_000;

const FED_FEEDS = [
  { id: "fed-monetary", label: "FED · Monetary Policy", url: "https://www.federalreserve.gov/feeds/press_monetary.xml" },
  { id: "fed-speeches", label: "FED · Speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml" },
  { id: "fed-powell", label: "FED · Jerome Powell", url: "https://www.federalreserve.gov/feeds/s_t_powell.xml" },
] as const;

interface GdeltArticle {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
}

interface GdeltResponse {
  articles?: unknown;
}

export async function GET() {
  const now = Date.now();
  const [gdeltResult, googleResult, ...feedResults] = await Promise.allSettled([
    fetchJson<GdeltResponse>(GDELT_URL, 300),
    fetchText(GOOGLE_NEWS_URL, 300),
    ...FED_FEEDS.map((feed) => fetchText(feed.url, 300)),
  ]);

  const items: NewsItem[] = [];
  const sources: SourceHealth[] = [];

  let gdeltItems: NewsItem[] = [];
  if (gdeltResult.status === "fulfilled") {
    gdeltItems = parseGdelt(gdeltResult.value);
    if (gdeltItems.length) {
      items.push(...gdeltItems);
      sources.push({ id: "gdelt", label: "GDELT", status: "ok", detail: "Noticias globales · últimas 48 h" });
    } else {
      sources.push({
        id: "gdelt",
        label: "GDELT",
        status: "degraded",
        detail: "La API respondió pero no devolvió artículos utilizables; se intenta el respaldo RSS.",
      });
    }
  } else {
    sources.push({ id: "gdelt", label: "GDELT", status: "degraded", detail: cleanError(gdeltResult.reason) });
  }

  if (!gdeltItems.length) {
    if (googleResult.status === "fulfilled") {
      const fallbackItems = parseGoogleNewsRss(googleResult.value);
      items.push(...fallbackItems);
      sources.push({
        id: "google-news",
        label: "Google News · respaldo",
        status: fallbackItems.length ? "ok" : "degraded",
        detail: fallbackItems.length
          ? "Respaldo RSS para noticias globales cuando GDELT no responde"
          : "El RSS respondió sin artículos utilizables",
      });
    } else {
      sources.push({
        id: "google-news",
        label: "Google News · respaldo",
        status: "degraded",
        detail: cleanError(googleResult.reason),
      });
    }
  }

  FED_FEEDS.forEach((feed, index) => {
    const result = feedResults[index];
    if (result?.status === "fulfilled") {
      items.push(...parseFedRss(result.value, feed.id === "fed-powell"));
      sources.push({ id: feed.id, label: feed.label, status: "ok", detail: "Fuente oficial Federal Reserve" });
    } else {
      sources.push({
        id: feed.id,
        label: feed.label,
        status: "degraded",
        detail: result?.status === "rejected" ? cleanError(result.reason) : "Fuente no disponible",
      });
    }
  });

  const deduped = dedupeNews(items)
    .filter((item) => item.publishedAt <= now + 3_600_000)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 50);

  return Response.json(
    { generatedAt: now, items: deduped, sources },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}

async function fetchText(url: string, revalidate: number): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MarketIntelligenceDashboard/1.0",
      Accept: "application/rss+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MarketIntelligenceDashboard/1.0",
      Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function parseGdelt(payload: GdeltResponse): NewsItem[] {
  if (!Array.isArray(payload.articles)) return [];
  return (payload.articles as GdeltArticle[]).flatMap((article, index) => {
    const title = asString(article.title);
    const url = asString(article.url);
    const publishedAt = parseGdeltDate(asString(article.seendate));
    if (!title || !url || publishedAt == null) return [];
    const source = asString(article.domain) ?? hostname(url) ?? "GDELT";
    return [
      {
        id: `gdelt-${publishedAt}-${index}`,
        title: decodeXml(title),
        url,
        publishedAt,
        source,
        impact: classifyNewsImpact(title),
        category: classifyNewsCategory(title),
        summary: null,
        official: false,
      },
    ];
  });
}

function parseFedRss(xml: string, powellFeed: boolean): NewsItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return blocks.flatMap((block, index) => {
    const title = rssValue(block, "title");
    const link = rssValue(block, "link");
    const date = rssValue(block, "pubDate") ?? rssValue(block, "dc:date");
    const description = stripHtml(rssValue(block, "description") ?? "");
    const publishedAt = date ? Date.parse(date) : Number.NaN;
    if (!title || !link || !Number.isFinite(publishedAt)) return [];
    const decoratedTitle = powellFeed && !/powell/i.test(title) ? `Jerome Powell · ${title}` : title;
    return [
      {
        id: `fed-${publishedAt}-${index}-${simpleHash(link)}`,
        title: decoratedTitle,
        url: link,
        publishedAt,
        source: "Federal Reserve",
        impact: classifyNewsImpact(decoratedTitle, description),
        category: classifyNewsCategory(decoratedTitle, description),
        summary: description || null,
        official: true,
      },
    ];
  });
}

function parseGoogleNewsRss(xml: string): NewsItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return blocks.flatMap((block, index) => {
    const title = rssValue(block, "title");
    const link = rssValue(block, "link");
    const date = rssValue(block, "pubDate");
    const source = rssValue(block, "source") ?? "Google News";
    const description = stripHtml(rssValue(block, "description") ?? "");
    const publishedAt = date ? Date.parse(date) : Number.NaN;
    if (!title || !link || !Number.isFinite(publishedAt)) return [];

    return [
      {
        id: `google-${publishedAt}-${index}-${simpleHash(link)}`,
        title,
        url: link,
        publishedAt,
        source,
        impact: classifyNewsImpact(title, description),
        category: classifyNewsCategory(title, description),
        summary: null,
        official: false,
      },
    ];
  });
}

function rssValue(block: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return null;
  return decodeXml(match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
}

function stripHtml(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 280);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseGdeltDate(value: string | null): number | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (compact) {
    return finiteTimestamp(
      Date.parse(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`),
    );
  }
  return finiteTimestamp(Date.parse(value));
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: NewsItem[] = [];
  const officialFirst = [...items].sort((a, b) => Number(b.official) - Number(a.official));
  for (const item of officialFirst) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrls.has(item.url) || seenTitles.has(normalizedTitle)) continue;
    seenUrls.add(item.url);
    seenTitles.add(normalizedTitle);
    result.push(item);
  }
  return result;
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function simpleHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteTimestamp(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function cleanError(reason: unknown): string {
  return reason instanceof Error ? reason.message.slice(0, 140) : "Fuente temporalmente no disponible";
}
