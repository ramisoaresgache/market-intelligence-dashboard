export type CryptoImpact = "positive" | "negative" | "mixed" | "neutral";

export type EconomicEventInput = {
  event: string;
  category: string;
  actual?: string;
  forecast?: string;
};

const translations: Array<[RegExp, string]> = [
  [/fed interest rate decision/i, "Decisión de tasas de la Fed"],
  [/interest rate decision/i, "Decisión de tasa de interés"],
  [/inflation rate/i, "Inflación"],
  [/consumer price index|\bCPI\b/i, "Índice de precios al consumidor"],
  [/core pce price index/i, "Inflación PCE subyacente"],
  [/pce price index/i, "Inflación PCE"],
  [/non farm payrolls/i, "Nóminas no agrícolas"],
  [/unemployment rate/i, "Tasa de desempleo"],
  [/jobless claims/i, "Solicitudes de desempleo"],
  [/new home sales/i, "Ventas de viviendas nuevas"],
  [/michigan sentiment/i, "Confianza del consumidor de Michigan"],
  [/business climate/i, "Clima empresarial"],
  [/gdp growth rate/i, "Crecimiento del PIB"],
  [/retail sales/i, "Ventas minoristas"],
  [/manufacturing pmi/i, "PMI manufacturero"],
  [/services pmi/i, "PMI de servicios"],
  [/consumer confidence/i, "Confianza del consumidor"],
  [/fomc minutes/i, "Minutas del FOMC"],
  [/fed chair/i, "Discurso de la presidencia de la Fed"],
];

export function translateEconomicEvent(event: string): string {
  const rateDecision = event.match(/^(.+?) Rate Decision/i);
  if (rateDecision) return event.replace(/^(.+?) Rate Decision/i, `Decisión de tasas del ${rateDecision[1]}`);
  for (const [pattern, translation] of translations) {
    if (pattern.test(event)) return event.replace(pattern, translation);
  }
  return event;
}

export function assessCryptoImpact(input: EconomicEventInput): { impact: CryptoImpact; summary: string } {
  const subject = `${input.category} ${input.event}`.toLowerCase();
  const actual = numericValue(input.actual);
  const forecast = numericValue(input.forecast);
  const surprise = actual != null && forecast != null ? Math.sign(actual - forecast) : null;

  if (/interest rate|rate decision|central-banks|monetary-policy|\btasa|fomc/.test(subject)) {
    if (surprise === 1) return { impact: "negative", summary: "Una tasa superior a la prevista suele endurecer la liquidez y presionar a los activos de riesgo, incluido cripto." };
    if (surprise === -1) return { impact: "positive", summary: "Una tasa inferior a la prevista suele favorecer la liquidez y a los activos de riesgo; la reacción no está garantizada." };
    return { impact: "mixed", summary: "Una suba de tasas suele ser negativa para cripto; una baja suele ser favorable. También importa la orientación futura del banco central." };
  }
  if (/inflation|consumer price|\bcpi\b|\bpce\b/.test(subject)) {
    if (surprise === 1) return { impact: "negative", summary: "Inflación por encima del consenso aumenta el riesgo de tasas altas por más tiempo y suele ser negativa para cripto." };
    if (surprise === -1) return { impact: "positive", summary: "Inflación inferior al consenso puede aliviar expectativas de tasas y suele favorecer a cripto." };
    return { impact: "mixed", summary: "El impacto depende de si la inflación sorprende por encima o por debajo del consenso." };
  }
  if (/unemployment|jobless claims|desempleo/.test(subject)) {
    if (surprise === 1) return { impact: "mixed", summary: "Mayor debilidad laboral puede impulsar expectativas de recortes, pero también aumentar el temor a recesión." };
    if (surprise === -1) return { impact: "mixed", summary: "Un empleo más sólido apoya el crecimiento, aunque puede retrasar recortes de tasas." };
    return { impact: "mixed", summary: "El mercado suele equilibrar expectativas de tasas contra el riesgo de recesión." };
  }
  if (/payroll|employment|retail sales|gdp|pmi|confidence/.test(subject)) {
    if (surprise === 1) return { impact: "mixed", summary: "Un dato fuerte mejora la perspectiva económica, pero puede reducir la probabilidad de recortes de tasas." };
    if (surprise === -1) return { impact: "mixed", summary: "Un dato débil puede favorecer recortes de tasas, aunque aumenta el riesgo de desaceleración." };
    return { impact: "mixed", summary: "Puede mover a cripto a través de las expectativas de crecimiento, dólar y tasas." };
  }
  return { impact: "neutral", summary: "No existe una relación direccional estable con cripto; conviene observar dólar, rendimientos y reacción del mercado." };
}

function numericValue(value?: string): number | null {
  if (!value) return null;
  const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
