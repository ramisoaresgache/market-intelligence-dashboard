import type {
  AssetBias,
  AssetImpact,
  MacroAsset,
  MacroEventKind,
  MacroScenario,
  NewsCategory,
  NewsImpact,
  ScenarioOption,
} from "./types";

const ASSETS: MacroAsset[] = ["BTC / crypto", "Nasdaq", "S&P 500", "DXY", "Yields"];

function impacts(values: Record<MacroAsset, AssetBias>): AssetImpact[] {
  return ASSETS.map((asset) => ({ asset, bias: values[asset] }));
}

const riskOn = impacts({
  "BTC / crypto": "bullish",
  Nasdaq: "bullish",
  "S&P 500": "bullish",
  DXY: "bearish",
  Yields: "bearish",
});

const riskOff = impacts({
  "BTC / crypto": "bearish",
  Nasdaq: "bearish",
  "S&P 500": "bearish",
  DXY: "bullish",
  Yields: "bullish",
});

const neutral = impacts({
  "BTC / crypto": "neutral",
  Nasdaq: "neutral",
  "S&P 500": "neutral",
  DXY: "neutral",
  Yields: "neutral",
});

const gdpLower = impacts({
  "BTC / crypto": "mixed",
  Nasdaq: "mixed",
  "S&P 500": "bearish",
  DXY: "bearish",
  Yields: "bearish",
});

const gdpHigher = impacts({
  "BTC / crypto": "mixed",
  Nasdaq: "mixed",
  "S&P 500": "bullish",
  DXY: "bullish",
  Yields: "bullish",
});

export function parseEconomicValue(value?: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").trim();
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([KMBT])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2]?.toUpperCase();
  if (suffix === "T") return base * 1_000_000_000_000;
  if (suffix === "B") return base * 1_000_000_000;
  if (suffix === "M") return base * 1_000_000;
  if (suffix === "K") return base * 1_000;
  return base;
}

export function classifyScenario(
  kind: MacroEventKind,
  actual?: string | null,
  forecast?: string | null,
): MacroScenario | null {
  const actualValue = parseEconomicValue(actual);
  const forecastValue = parseEconomicValue(forecast);
  if (actualValue == null || forecastValue == null) return null;

  const tolerance = Math.max(Math.abs(forecastValue) * 0.001, 1e-9);
  const delta = actualValue - forecastValue;
  const relation = Math.abs(delta) <= tolerance ? "inline" : delta < 0 ? "lower" : "higher";

  if (kind === "fomc") {
    if (relation === "lower") return "dovish";
    if (relation === "higher") return "hawkish";
    return "neutral";
  }

  return relation;
}

export function scenarioOptions(kind: MacroEventKind): ScenarioOption[] {
  if (kind === "fomc" || kind === "powell") {
    return [
      {
        key: "dovish",
        label: "Dovish",
        description: "Menor presión de tasas o un mensaje más flexible de lo descontado.",
        impacts: riskOn,
      },
      {
        key: "neutral",
        label: "Neutral",
        description: "Decisión y comunicación cercanas a lo esperado por el mercado.",
        impacts: neutral,
      },
      {
        key: "hawkish",
        label: "Hawkish",
        description: "Mayor presión de tasas o un mensaje más restrictivo de lo descontado.",
        impacts: riskOff,
      },
    ];
  }

  if (kind === "unemployment") {
    return [
      {
        key: "lower",
        label: "Menor a lo esperado",
        description: "Mercado laboral más fuerte; puede reducir expectativas de recortes.",
        impacts: riskOff,
      },
      {
        key: "inline",
        label: "En línea",
        description: "Sorpresa limitada frente al consenso.",
        impacts: neutral,
      },
      {
        key: "higher",
        label: "Mayor a lo esperado",
        description: "Mercado laboral más débil; puede aumentar expectativas de flexibilización.",
        impacts: riskOn,
      },
    ];
  }

  if (kind === "gdp") {
    return [
      {
        key: "lower",
        label: "Menor a lo esperado",
        description: "Crecimiento más débil. Riesgo de desaceleración, pero también de tasas más bajas.",
        impacts: gdpLower,
      },
      {
        key: "inline",
        label: "En línea",
        description: "Crecimiento cercano al consenso; reacción normalmente más acotada.",
        impacts: neutral,
      },
      {
        key: "higher",
        label: "Mayor a lo esperado",
        description: "Crecimiento más fuerte. Favorece actividad, aunque puede sostener yields y dólar.",
        impacts: gdpHigher,
      },
    ];
  }

  return [
    {
      key: "lower",
      label: "Menor a lo esperado",
      description:
        kind === "nfp"
          ? "Empleo más débil; suele aliviar expectativas de tasas."
          : "Inflación más suave; suele favorecer expectativas de tasas más bajas.",
      impacts: riskOn,
    },
    {
      key: "inline",
      label: "En línea",
      description: "Lectura cercana al consenso; la sorpresa macro es limitada.",
      impacts: neutral,
    },
    {
      key: "higher",
      label: "Mayor a lo esperado",
      description:
        kind === "nfp"
          ? "Empleo más fuerte; puede sostener una postura monetaria restrictiva."
          : "Inflación más alta; suele aumentar presión sobre tasas y yields.",
      impacts: riskOff,
    },
  ];
}

export function classifyNewsImpact(title: string, summary = ""): NewsImpact {
  const text = `${title} ${summary}`.toLowerCase();
  if (
    /fomc|federal funds|powell|rate decision|interest rate|consumer price index|\bcpi\b|\bpce\b|nonfarm|non-farm|payroll|unemployment|gross domestic product|\bgdp\b/.test(
      text,
    )
  ) {
    return "high";
  }
  if (
    /federal reserve|inflation|jobs report|treasury|yield|nasdaq|s&p 500|bitcoin|ethereum|crypto|sec |etf|stablecoin|regulation|tariff|sanction|war|attack/.test(
      text,
    )
  ) {
    return "medium";
  }
  return "low";
}

export function classifyNewsCategory(title: string, summary = ""): NewsCategory {
  const text = `${title} ${summary}`.toLowerCase();
  if (/federal reserve|\bfed\b|fomc|powell|interest rate/.test(text)) return "fed";
  if (/cpi|pce|inflation|payroll|unemployment|gdp|jobs report|economic data/.test(text)) return "macro";
  if (/bitcoin|ethereum|crypto|stablecoin|blockchain/.test(text)) return "crypto";
  if (/sec |regulat|legislation|lawmakers|court/.test(text)) return "regulation";
  if (/nasdaq|s&p|stocks|equities|dollar|dxy|treasury|yield/.test(text)) return "markets";
  if (/war|attack|sanction|geopolit|conflict|missile/.test(text)) return "geopolitics";
  return "other";
}
