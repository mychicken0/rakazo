import type { ModelCatalogEntry } from "@rakazo/contracts";
import type { DecisionProtocolProvider } from "./http-decisions.js";

/** Protocol/pricing belongs to the adapter catalog, never approval policy. */
const models: Array<{
  provider: DecisionProtocolProvider;
  providerName: string;
  id: string;
  label: string;
  inputUsdPerMillion: number;
}> = [
  {
    provider: "openrouter",
    providerName: "OpenRouter",
    id: "typesafe/jev-1.14",
    label: "Jev 1.14",
    inputUsdPerMillion: 0.042,
  },
  {
    provider: "openrouter",
    providerName: "OpenRouter",
    id: "perplexity/pplx-decider-flash-v1.3:free",
    label: "Decider Flash 1.3 (free)",
    inputUsdPerMillion: 0,
  },
  {
    provider: "google",
    providerName: "Google",
    id: "gemini-decision-1",
    label: "Gemini Decision 1",
    inputUsdPerMillion: 0.1,
  },
];
export function decisionModel(provider: string, id: string) {
  return models.find((model) => model.provider === provider && model.id === id);
}
export function decisionModelCatalog(): ModelCatalogEntry[] {
  return models.map((model) => ({
    provider: model.provider,
    providerName: model.providerName,
    id: model.id,
    label: model.label,
    protocol: "decisions",
    billing: "Uses your API key",
    auth: "api-key",
  }));
}
