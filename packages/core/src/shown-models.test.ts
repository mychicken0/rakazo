import { describe, expect, it } from "vitest";
import { visibleModelEntries } from "./model-providers.js";

const entry = (provider: string, id: string, protocol?: string) => ({ provider, id, protocol });
const entries = [
  entry("openrouter", "a"),
  entry("openrouter", "b"),
  entry("openrouter", "d", "decisions"),
  entry("anthropic", "c"),
];
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

describe("visibleModelEntries", () => {
  it("shows everything without lists", () => {
    expect(ids(visibleModelEntries(entries, [{ provider: "openrouter" }]))).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("hides models no connection of the provider lists, never decisions", () => {
    const shown = visibleModelEntries(entries, [{ provider: "openrouter", shownModelIds: ["a"] }]);
    expect(ids(shown)).toEqual(["a", "d", "c"]);
  });

  it("shows all while any connection of the provider has no list", () => {
    const credentials = [
      { provider: "openrouter", shownModelIds: ["a"] },
      { provider: "openrouter" },
    ];
    expect(ids(visibleModelEntries(entries, credentials))).toEqual(["a", "b", "d", "c"]);
  });

  it("unions the lists of several connections", () => {
    const credentials = [
      { provider: "openrouter", shownModelIds: ["a"] },
      { provider: "openrouter", shownModelIds: ["b"] },
    ];
    expect(ids(visibleModelEntries(entries, credentials))).toEqual(["a", "b", "d", "c"]);
  });

  it("keeps the selected model", () => {
    const shown = visibleModelEntries(entries, [{ provider: "openrouter", shownModelIds: ["a"] }], {
      provider: "openrouter",
      modelId: "b",
    });
    expect(ids(shown)).toEqual(["a", "b", "d", "c"]);
  });
});
