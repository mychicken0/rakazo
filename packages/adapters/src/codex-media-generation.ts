import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaVideoJob,
  SecretStore,
} from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { findModelCredential } from "@rakazo/db";
import { mediaPromptSchema, validateGeneratedMedia } from "./media-generation-provider.js";
import { resolveStoredModelAuth, withModelCredentialLock } from "./model-credential-refresh.js";
import { CHATGPT_OAUTH_PROVIDER, isRetiredModelCredentialError } from "./pi-oauth.js";

export const CODEX_MEDIA_DEFAULT_MODEL = "gpt-5.6-luna";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
/** Base64 of the largest PNG an attachment may hold, plus room for the rest of the stream. */
const MAX_STREAM_BYTES = Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 1_000_000;

export type CodexMediaDeps = {
  prisma: Pick<
    PrismaClient,
    "$transaction" | "secret" | "userModelCredential" | "userModelPreference"
  >;
  secretStore: Pick<SecretStore, "load" | "put" | "delete">;
  model?: string;
  fetch?: typeof fetch;
};

/** The ChatGPT account a Codex token belongs to; Codex wants it on every request. */
export function codexAccountId(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const id = claims?.[JWT_AUTH_CLAIM]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Images through the account's ChatGPT sign-in (Codex): the same subscription its chat
 * models use, so no separate media key or bill. Each request reads the model connection,
 * so a refresh or reconnect there carries over. Codex has no video model.
 */
export class CodexMediaGenerationProvider implements MediaGenerationProvider {
  readonly id = "codex";
  readonly capabilities = { images: true, video: false, offline: false };
  constructor(private readonly deps: CodexMediaDeps) {}

  private async accessToken(context: AdapterContext): Promise<string> {
    const scope = { userId: context.userId, spaceId: context.spaceId };
    const credential = await findModelCredential(
      this.deps.prisma,
      { userId: scope.userId },
      CHATGPT_OAUTH_PROVIDER,
    );
    if (!credential) throw new MediaGenerationError("authentication");
    return withModelCredentialLock(credential.secretId, async () => {
      const row = await this.deps.prisma.secret.findFirst({
        where: { id: credential.secretId, userId: scope.userId, spaceId: null },
      });
      if (!row) throw new MediaGenerationError("authentication");
      const stored = await this.deps.secretStore.load(row.ciphertext, row.id);
      try {
        const { apiKey } = await resolveStoredModelAuth(
          this.deps.prisma,
          this.deps.secretStore,
          scope,
          credential,
          stored,
          CHATGPT_OAUTH_PROVIDER,
          { signal: context.signal },
        );
        if (!apiKey) throw new MediaGenerationError("authentication");
        return apiKey;
      } catch (error) {
        if (error instanceof MediaGenerationError) throw error;
        if (isRetiredModelCredentialError(error)) throw new MediaGenerationError("authentication");
        context.signal.throwIfAborted();
        throw new MediaGenerationError("provider_failure");
      }
    });
  }

  async generateImage(
    input: MediaGenerationInput,
    context: AdapterContext,
  ): Promise<GeneratedMedia> {
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");
    const token = await this.accessToken(context);
    const accountId = codexAccountId(token);
    if (!accountId) throw new MediaGenerationError("authentication");
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(180_000)]);
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "chatgpt-account-id": accountId,
          "OpenAI-Beta": "responses=experimental",
          originator: "pi",
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        // No reasoning settings: the image model rejects every reasoning effort.
        body: JSON.stringify({
          model: this.deps.model || CODEX_MEDIA_DEFAULT_MODEL,
          instructions:
            "Call the image_generation tool exactly once, using the user's description as the prompt without changing it.",
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: parsed.data.prompt }],
            },
          ],
          tools: [{ type: "image_generation", output_format: "png" }],
          tool_choice: { type: "image_generation" },
          parallel_tool_calls: false,
          stream: true,
          store: false,
        }),
        signal,
        redirect: "error",
      });
    } catch {
      context.signal.throwIfAborted();
      throw new MediaGenerationError("provider_failure");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MediaGenerationError(
        response.status === 429
          ? "rate_limit"
          : [401, 403].includes(response.status)
            ? "authentication"
            : "provider_failure",
      );
    }
    const base64 = await readImageResult(response, signal).catch((error) => {
      context.signal.throwIfAborted();
      throw error instanceof MediaGenerationError
        ? error
        : new MediaGenerationError("provider_failure");
    });
    const output: GeneratedMedia = {
      mimeType: "image/png",
      bytes: Buffer.from(base64, "base64"),
    };
    validateGeneratedMedia(output, "image/png");
    return output;
  }

  async generateVideo(): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }

  async pollVideo(): Promise<MediaVideoJob> {
    throw new MediaGenerationError("unsupported");
  }
}

/** The base64 PNG from a Codex response stream's finished image_generation_call. */
export async function readImageResult(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new MediaGenerationError("provider_failure");
  const decoder = new TextDecoder();
  let buffer = "";
  let received = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (value) {
        received += value.byteLength;
        if (received > MAX_STREAM_BYTES) throw new MediaGenerationError("output_limit");
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const result = imageFromEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (result) return result;
        end = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    const result = imageFromEvent(buffer);
    if (result) return result;
    throw new MediaGenerationError("provider_failure");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function imageFromEvent(block: string): string | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  let event: { type?: string; item?: { type?: string; result?: unknown }; error?: unknown };
  try {
    event = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (event.type === "error" || event.type === "response.failed") {
    throw new MediaGenerationError("provider_failure");
  }
  if (
    event.type === "response.output_item.done" &&
    event.item?.type === "image_generation_call" &&
    typeof event.item.result === "string" &&
    event.item.result
  ) {
    return event.item.result;
  }
  return undefined;
}
