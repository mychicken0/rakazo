import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it, vi } from "vitest";
import { liveModelSibling } from "./pi-live-model.js";
import { applyPiModelCompatibility } from "./pi-model-compat.js";
import { catalogProviderListsModels, probeCatalogProviderModels } from "./pi-models.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("native provider model lists", () => {
  it("lists an Anthropic key's models from its own API", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [{ id: "claude-fable-5-2" }, { id: "claude-opus-5-5" }] }));
    const ids = await probeCatalogProviderModels(
      { provider: "anthropic", apiKey: "fake-key" },
      fetchMock,
    );
    expect(ids).toEqual(["claude-fable-5-2", "claude-opus-5-5"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(init?.headers).toMatchObject({ "x-api-key": "fake-key" });
  });

  it("lists only Google models that generate content, across pages", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          models: [
            { name: "models/gemini-4-hydrogen", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-decision-1", supportedGenerationMethods: ["createDecision"] },
          ],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        json({
          models: [
            { name: "models/gemini-5-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
      );
    const ids = await probeCatalogProviderModels(
      { provider: "google", apiKey: "fake-key" },
      fetchMock,
    );
    expect(ids).toEqual(["gemini-4-hydrogen", "gemini-5-flash"]);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("pageToken=next");
  });

  it("reports a rejected key without echoing it", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({}, 401));
    await expect(
      probeCatalogProviderModels({ provider: "anthropic", apiKey: "fake-key" }, fetchMock),
    ).rejects.toThrow(/key/i);
  });

  it("counts both providers as able to list models", () => {
    expect(catalogProviderListsModels("anthropic")).toBe(true);
    expect(catalogProviderListsModels("google")).toBe(true);
  });
});

describe("live models on a provider's own protocol", () => {
  const models = applyPiModelCompatibility(builtinModels());
  it("runs a newer version of a known family with that family's capabilities", () => {
    const sibling = models.getModel("anthropic", "claude-fable-5-1")!;
    const model = liveModelSibling(models, "anthropic", "claude-fable-5-2");
    expect(model).toMatchObject({
      id: "claude-fable-5-2",
      api: sibling.api,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: sibling.contextWindow,
    });
  });
  it("does not invent a model of an unknown family", () => {
    expect(liveModelSibling(models, "anthropic", "openai/gpt-6-luna")).toBeUndefined();
    expect(liveModelSibling(models, "google", "imagined-model")).toBeUndefined();
  });
});
