export interface FearGreedReading {
  value: number;
  classification: string;
  updatedAt: number;
  nextUpdateSeconds: number | null;
  source: "Alternative.me";
}

type AlternativeFearGreedResponse = {
  data?: Array<{
    value?: unknown;
    value_classification?: unknown;
    timestamp?: unknown;
    time_until_update?: unknown;
  }>;
  metadata?: { error?: unknown };
};

const CLASSIFICATIONS: Record<string, string> = {
  "Extreme Fear": "Miedo extremo",
  Fear: "Miedo",
  Neutral: "Neutral",
  Greed: "Codicia",
  "Extreme Greed": "Codicia extrema",
};

export function parseFearGreedResponse(payload: unknown): FearGreedReading {
  if (!payload || typeof payload !== "object") throw new Error("Respuesta inválida del índice");
  const response = payload as AlternativeFearGreedResponse;
  if (response.metadata?.error) throw new Error("El proveedor informó un error");
  const reading = response.data?.[0];
  const value = Number(reading?.value);
  const timestamp = Number(reading?.timestamp);
  if (!Number.isFinite(value) || value < 0 || value > 100 || !Number.isFinite(timestamp)) {
    throw new Error("Lectura inválida del índice");
  }
  const rawClassification = typeof reading?.value_classification === "string"
    ? reading.value_classification
    : "Neutral";
  const nextUpdate = Number(reading?.time_until_update);
  return {
    value,
    classification: CLASSIFICATIONS[rawClassification] ?? rawClassification,
    updatedAt: timestamp * 1_000,
    nextUpdateSeconds: Number.isFinite(nextUpdate) ? nextUpdate : null,
    source: "Alternative.me",
  };
}
