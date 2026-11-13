import { createHash } from "node:crypto";
import type { SecretStore } from "@rakazo/adapter-kit";
import type { ModelCatalogEntry } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { DecisionProtocolProvider } from "./http-decisions.js";
import { parseModelSecret } from "./model-secret.js";

/** A decision model a provider serves, read from that provider's own model list. */
export type DecisionModel = {
  provider: DecisionProtocolProvider;
  providerName: string;
  id: string;
  label: string;
  /** Unknown when the provider's list does not price it. */
  inputUsdPerMillion?: number;
};

const LIST_TTL_MS = 60 * 60_000;
const FAILED_LIST_TTL_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 8_000;
const MAX_MODELS = 500;
const MAX_PAGES = 5;

const lists = new Map<string, { models: DecisionModel[]; expiresAt: number }>();
/** Every decision model seen in a list, so a run can price and route it without a refetch. */
const known = new Map<string, DecisionModel>();

const keyOf = (provider: string, id: string) => `${provider}:${id}`;

async function readList(
  key: string,
  load: () => Promise<DecisionModel[]>,
  now = Date.now(),
): Promise<DecisionModel[]> {
  const cached = lists.get(key);
  if (cached && cached.expiresAt > now) return cached.models;
  try {
    const models = (await load()).slice(0, MAX_MODELS);
    lists.set(key, { models, expiresAt: now + LIST_TTL_MS });
    rememberDecisionModels(models);
    return models;
  } catch {
    // Keep the last good list for a while; an outage must not empty the approval picker.
    const models = cached?.models ?? [];
    lists.set(key, { models, expiresAt: now + FAILED_LIST_TTL_MS });
    return models;
  }
}

async function fetchJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", ...headers },
    redirect: "error",
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`model list failed: ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** OpenRouter's public list, filtered to models whose output is decisions. */
async function openRouterDecisionModels(fetchImpl: typeof fetch): Promise<DecisionModel[]> {
  const body = await fetchJson(
    "https://openrouter.ai/api/v1/models?output_modalities=decisions",
    {},
    fetchImpl,
  );
  const data = Array.isArray(body.data) ? body.data : [];
  return data.flatMap((raw) => {
    const model = raw as {
      id?: unknown;
      name?: unknown;
      architecture?: { output_modalities?: unknown };
      pricing?: { prompt?: unknown };
    };
    const outputs = model.architecture?.output_modalities;
    if (typeof model.id !== "string" || !Array.isArray(outputs) || !outputs.includes("decisions"))
      return [];
    const perToken = Number(model.pricing?.prompt);
    return [
      {
        provider: "openrouter" as const,
        providerName: "OpenRouter",
        id: model.id,
        label: typeof model.name === "string" ? model.name : model.id,
        ...(Number.isFinite(perToken) && perToken >= 0
          ? { inputUsdPerMillion: perToken * 1_000_000 }
          : {}),
      },
    ];
  });
}

/** The Gemini models this key can call through the decisions method. */
async function googleDecisionModels(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<DecisionModel[]> {
  const out: DecisionModel[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { "x-goog-api-key": apiKey },
      fetchImpl,
    );
    for (const raw of Array.isArray(body.models) ? body.models : []) {
      const model = raw as {
        name?: unknown;
        displayName?: unknown;
        supportedGenerationMethods?: unknown;
      };
      const methods = model.supportedGenerationMethods;
      if (typeof model.name !== "string" || !Array.isArray(methods)) continue;
      if (!methods.includes("createDecision")) continue;
      const id = model.name.replace(/^models\//, "");
      out.push({
        provider: "google",
        providerName: "Google",
        id,
        label: typeof model.displayName === "string" ? model.displayName : id,
      });
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
    if (!pageToken) break;
  }
  return out;
}

/**
 * The decision models the member's connections can use, read live from each provider: OpenRouter's
 * list of decision-output models, and the Gemini models a Google key can call for decisions.
 */
export async function liveDecisionModels(
  deps: {
    prisma: PrismaClient;
    secrets: Pick<SecretStore, "load">;
    fetch?: typeof fetch;
  },
  userId: string,
): Promise<DecisionModel[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const connections = await deps.prisma.userModelCredential.findMany({
    where: { userId, provider: { in: ["openrouter", "google"] } },
    select: { provider: true, secretId: true },
    orderBy: { updatedAt: "desc" },
  });
  const out: DecisionModel[] = [];
  if (connections.some((connection) => connection.provider === "openrouter"))
    out.push(...(await readList("openrouter", () => openRouterDecisionModels(fetchImpl))));
  const google = connections.find((connection) => connection.provider === "google");
  if (google) {
    const row = await deps.prisma.secret.findFirst({
      where: { id: google.secretId, userId, spaceId: null },
      select: { id: true, ciphertext: true },
    });
    if (row) {
      // Cache identity is the stored secret's hash; the key is decrypted only to list.
      const version = createHash("sha256").update(row.ciphertext).digest("hex");
      out.push(
        ...(await readList(`google:${version}`, async () => {
          const secret = parseModelSecret(await deps.secrets.load(row.ciphertext, row.id));
          return secret.kind === "api_key" ? googleDecisionModels(secret.key, fetchImpl) : [];
        })),
      );
    }
  }
  return out;
}

/** Records decision models read from a provider, so runs can price and route them. */
export function rememberDecisionModels(models: readonly DecisionModel[]): void {
  for (const model of models) known.set(keyOf(model.provider, model.id), model);
}

/** A decision model already seen in a provider's list. */
export function decisionModel(provider: string, id: string): DecisionModel | undefined {
  return known.get(keyOf(provider, id));
}

/** Reads a provider's decision models again on the next request. */
export function invalidateDecisionModels(provider: string): void {
  for (const key of lists.keys())
    if (key === provider || key.startsWith(`${provider}:`)) lists.delete(key);
}

export function decisionModelCatalog(models: readonly DecisionModel[]): ModelCatalogEntry[] {
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
