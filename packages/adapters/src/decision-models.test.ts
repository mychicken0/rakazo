import { describe, expect, it, vi } from "vitest";
import {
  decisionModel,
  decisionModelCatalog,
  invalidateDecisionModels,
  liveDecisionModels,
} from "./decision-models.js";

const json = (body: unknown) => new Response(JSON.stringify(body));

function deps(fetchImpl: typeof fetch, providers: string[]) {
  return {
    fetch: fetchImpl,
    secrets: { load: vi.fn(async () => "fake-google-key") },
    prisma: {
      userModelCredential: {
        findMany: vi.fn(async () =>
          providers.map((provider) => ({ provider, secretId: `${provider}-secret` })),
        ),
      },
      secret: {
        findFirst: vi.fn(async () => ({ id: "google-secret", ciphertext: "cipher" })),
      },
    } as never,
  };
}

describe("live decision models", () => {
  it("reads OpenRouter's decision-output models and a Google key's decision models", async () => {
    invalidateDecisionModels("openrouter");
    invalidateDecisionModels("google");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://openrouter.ai/"))
        return json({
          data: [
            {
              id: "perplexity/pplx-decider-flash-v1.3:free",
              name: "Perplexity: Decider Flash V1.3 (free)",
              architecture: { output_modalities: ["decisions"] },
              pricing: { prompt: "0" },
            },
            {
              id: "typesafe/jev-1.14",
              name: "TypeSafe: Jev 1.14",
              architecture: { output_modalities: ["decisions"] },
              pricing: { prompt: "0.000000042" },
            },
            { id: "some/chat-model", architecture: { output_modalities: ["text"] } },
          ],
        });
      return json({
        models: [
          {
            name: "models/gemini-decision-1",
            displayName: "Gemini Decision 1",
            supportedGenerationMethods: ["createDecision"],
          },
          { name: "models/gemini-4-hydrogen", supportedGenerationMethods: ["generateContent"] },
        ],
      });
    });
    const models = await liveDecisionModels(deps(fetchMock, ["openrouter", "google"]), "user-1");
    expect(models.map((model) => `${model.provider}:${model.id}`)).toEqual([
      "openrouter:perplexity/pplx-decider-flash-v1.3:free",
      "openrouter:typesafe/jev-1.14",
      "google:gemini-decision-1",
    ]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("output_modalities=decisions");
    expect(decisionModel("openrouter", "typesafe/jev-1.14")?.inputUsdPerMillion).toBeCloseTo(0.042);
    expect(decisionModelCatalog(models)[2]).toMatchObject({
      provider: "google",
      label: "Gemini Decision 1",
      protocol: "decisions",
    });
  });

  it("asks only the providers the member has connected, and caches the list", async () => {
    invalidateDecisionModels("openrouter");
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: [] }));
    await liveDecisionModels(deps(fetchMock, ["anthropic"]), "user-1");
    expect(fetchMock).not.toHaveBeenCalled();
    await liveDecisionModels(deps(fetchMock, ["openrouter"]), "user-1");
    await liveDecisionModels(deps(fetchMock, ["openrouter"]), "user-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
