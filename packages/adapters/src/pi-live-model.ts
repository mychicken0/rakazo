import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { DEFAULT_MODEL_CONTEXT_WINDOW } from "@rakazo/contracts";

/** Models endpoints often mix chat models with tools and media endpoints. */
export function isChatModelId(id: string): boolean {
  return (
    /^[\x21-\x7e]{1,1024}$/.test(id) &&
    !/(embed|(?:^|[-/_])tts(?:[-/_]|$)|whisper|transcrib|audio|realtime|dall-e|gpt-image|imagen|moderation|rerank|stable-diffusion|\bflux\b|image|text-to-speech|speech-to-text|\bsora\b|\bveo\b|video|\bocr\b|davinci|babbage|turbo-instruct|computer-use)/i.test(
      id,
    )
  );
}

/**
 * The account catalog's image answer replaces whatever modalities were guessed.
 * An absent answer leaves them alone, including the text-only cross-family fallback.
 */
export function withLiveImageInput(
  model: Model<Api>,
  supportsImages: boolean | undefined,
): Model<Api> {
  if (supportsImages === undefined) return model;
  const input: Model<Api>["input"] = supportsImages ? ["text", "image"] : ["text"];
  if (
    model.input.length === input.length &&
    input.every((modality, index) => model.input[index] === modality)
  ) {
    return model;
  }
  return { ...model, input };
}

const OPENAI_STYLE_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);
const NATIVE_APIS = new Set(["anthropic-messages", "google-generative-ai"]);

/** A deterministic fallback shared by listing and execution; never changes provider or host. */
export function liveModelSibling(
  models: Models,
  provider: string,
  id: string,
): Model<Api> | undefined {
  if (!isChatModelId(id)) return undefined;
  const all = models.getProvider?.(provider)?.getModels() ?? [];
  const openAiStyle = all.filter((model) => OPENAI_STYLE_APIS.has(model.api));
  // A provider's own protocol (Anthropic Messages, Gemini) serves only its own families, so a
  // live id runs there only as a newer member of a family the registry already knows.
  const native = openAiStyle.length === 0;
  const siblings = native ? all.filter((model) => NATIVE_APIS.has(model.api)) : openAiStyle;
  const urls = new Set(siblings.map((model) => model.baseUrl));
  if (urls.size !== 1 || siblings.length === 0) return undefined;
  const url = new URL(siblings[0]!.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || /[{}]/.test(url.href))
    return undefined;
  const prefixLength = (other: string) => {
    let n = 0;
    while (n < id.length && id[n] === other[n]) n++;
    return n;
  };
  const sibling = [...siblings].sort((a, b) => prefixLength(b.id) - prefixLength(a.id))[0]!;
  // A date/alias variant, or a newer version number of the same name (claude-fable-5-2 next to
  // claude-fable-5-1), proves the same family and its capabilities.
  const family = (value: string) =>
    value.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4,8}|latest)$/, "").replace(/(?:[-.]\d+)+$/, "");
  const sameFamily = family(id) === family(sibling.id);
  if (native && !sameFamily) return undefined;
  return {
    ...sibling,
    id,
    name: id,
    reasoning: sameFamily && sibling.reasoning,
    input: sameFamily ? [...sibling.input] : ["text"],
    // An unrelated sibling's window says nothing about this model's.
    contextWindow: sameFamily ? sibling.contextWindow : DEFAULT_MODEL_CONTEXT_WINDOW,
  };
}
