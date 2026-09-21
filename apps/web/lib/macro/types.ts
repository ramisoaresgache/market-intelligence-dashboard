export type MacroEventKind =
  | "cpi"
  | "core-cpi"
  | "pce"
  | "core-pce"
  | "nfp"
  | "unemployment"
  | "gdp"
  | "fomc"
  | "powell";

export type MacroImpact = "low" | "medium" | "high";
export type NumericScenario = "lower" | "inline" | "higher";
export type FedScenario = "dovish" | "neutral" | "hawkish";
export type MacroScenario = NumericScenario | FedScenario;
export type AssetBias = "bullish" | "bearish" | "neutral" | "mixed";
export type MacroAsset = "BTC / crypto" | "Nasdaq" | "S&P 500" | "DXY" | "Yields";

export type AssetImpact = {
  asset: MacroAsset;
  bias: AssetBias;
};

export type ScenarioOption = {
  key: MacroScenario;
  label: string;
  description: string;
  impacts: AssetImpact[];
};

export type MacroEvent = {
  id: string;
  kind: MacroEventKind;
  title: string;
  timestamp: number;
  impact: MacroImpact;
  reference?: string | null;
  previous?: string | null;
  forecast?: string | null;
  actual?: string | null;
  scenario?: MacroScenario | null;
  source: string;
  sourceUrl?: string | null;
  expectationsSource?: string | null;
  verifiedOfficial: boolean;
};

export type SourceHealth = {
  id: string;
  label: string;
  status: "ok" | "degraded" | "error";
  detail?: string;
};

export type MacroApiResponse = {
  generatedAt: number;
  events: MacroEvent[];
  sources: SourceHealth[];
};

export type NewsImpact = "low" | "medium" | "high";
export type NewsCategory = "fed" | "macro" | "crypto" | "regulation" | "markets" | "geopolitics" | "other";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: number;
  source: string;
  impact: NewsImpact;
  category: NewsCategory;
  summary?: string | null;
  official: boolean;
};

export type NewsApiResponse = {
  generatedAt: number;
  items: NewsItem[];
  sources: SourceHealth[];
};
