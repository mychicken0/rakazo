import type { MediaGenerationProvider } from "@rakazo/adapter-kit";
import type { CodexMediaDeps } from "./codex-media-generation.js";
import { CodexMediaGenerationProvider } from "./codex-media-generation.js";
import {
  FakeMediaGenerationProvider,
  FalMediaGenerationProvider,
} from "./media-generation-provider.js";

export function createMediaGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
  stores?: Pick<CodexMediaDeps, "prisma" | "secretStore">,
): MediaGenerationProvider | undefined {
  const kind = env.MEDIA_GENERATION_PROVIDER?.trim().toLowerCase();
  if (!kind || kind === "disabled") return undefined;
  if (kind === "fake") return new FakeMediaGenerationProvider();
  // Uses the account's ChatGPT sign-in from Models settings, so it needs no key of its own.
  if (kind === "codex") {
    if (!stores) throw new Error("Media generation through Codex needs the credential store");
    return new CodexMediaGenerationProvider({
      ...stores,
      model: env.MEDIA_GENERATION_IMAGE_MODEL?.trim() || undefined,
    });
  }
  if (kind !== "fal") throw new Error("Unknown media generation provider");
  const apiKey = env.MEDIA_GENERATION_API_KEY?.trim();
  const imageModel = env.MEDIA_GENERATION_IMAGE_MODEL?.trim();
  const videoModel = env.MEDIA_GENERATION_VIDEO_MODEL?.trim();
  if (!apiKey || (!imageModel && !videoModel))
    throw new Error("Media generation requires credentials and at least one model");
  return new FalMediaGenerationProvider({
    apiKey,
    imageModel,
    videoModel,
    baseUrl: env.MEDIA_GENERATION_BASE_URL,
  });
}
