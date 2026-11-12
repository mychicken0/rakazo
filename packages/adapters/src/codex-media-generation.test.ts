import type { AdapterContext } from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findModelCredential = vi.fn();
const resolveStoredModelAuth = vi.fn();
vi.mock("@rakazo/db", () => ({
  findModelCredential: (...args: unknown[]) => findModelCredential(...args),
}));
vi.mock("./model-credential-refresh.js", () => ({
  resolveStoredModelAuth: (...args: unknown[]) => resolveStoredModelAuth(...args),
  withModelCredentialLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

const { CodexMediaGenerationProvider, codexAccountId, readImageResult } = await import(
  "./codex-media-generation.js"
);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=",
  "base64",
);
const token = (claims: unknown) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const TOKEN = token({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" } });

const sse = (...events: unknown[]) =>
  events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join("");
/** A stream cut into small pieces, so events arrive split across reads. */
const streamOf = (text: string, size = 7) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(text);
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
  );
const done = (result: string) => ({
  type: "response.output_item.done",
  item: { type: "image_generation_call", result },
});

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

function provider(fetch: typeof globalThis.fetch) {
  const prisma = {
    secret: { findFirst: vi.fn(async () => ({ id: "secret-1", ciphertext: "sealed" })) },
  };
  const secretStore = { load: vi.fn(async () => "stored"), put: vi.fn(), delete: vi.fn() };
  return new CodexMediaGenerationProvider({
    prisma: prisma as never,
    secretStore: secretStore as never,
    fetch,
  });
}

describe("codex media generation", () => {
  beforeEach(() => {
    findModelCredential.mockReset().mockResolvedValue({ id: "cred-1", secretId: "secret-1" });
    resolveStoredModelAuth.mockReset().mockResolvedValue({ apiKey: TOKEN });
  });

  it("reads the account id from the token", () => {
    expect(codexAccountId(TOKEN)).toBe("acct-test");
    expect(codexAccountId("not-a-token")).toBeUndefined();
  });

  it("returns the PNG from the image call, even when events are split across reads", async () => {
    const result = await readImageResult(
      streamOf(sse({ type: "response.created" }, done(PNG.toString("base64")))),
      new AbortController().signal,
    );
    expect(result).toBe(PNG.toString("base64"));
  });

  it("fails on a provider error event", async () => {
    await expect(
      readImageResult(
        streamOf(sse({ type: "error", error: { message: "nope" } })),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("asks for one image with the signed-in account and no reasoning settings", async () => {
    const fetch = vi.fn(async () => streamOf(sse(done(PNG.toString("base64")))));
    const output = await provider(fetch as never).generateImage({ prompt: "a chicken" }, context);
    expect(output.mimeType).toBe("image/png");
    expect(Buffer.from(output.bytes)).toEqual(PNG);
    expect(findModelCredential).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1" },
      "openai-codex",
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["chatgpt-account-id"]).toBe("acct-test");
    const body = JSON.parse(String(init.body));
    expect(body.tool_choice).toEqual({ type: "image_generation" });
    expect(body.reasoning).toBeUndefined();
    expect(body.input[0].content[0].text).toBe("a chicken");
  });

  it("reports a missing sign-in as an authentication error without calling out", async () => {
    findModelCredential.mockResolvedValue(null);
    const fetch = vi.fn();
    await expect(
      provider(fetch as never).generateImage({ prompt: "a chicken" }, context),
    ).rejects.toEqual(new MediaGenerationError("authentication"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a 429 to a rate limit", async () => {
    const fetch = vi.fn(async () => new Response("slow down", { status: 429 }));
    await expect(
      provider(fetch as never).generateImage({ prompt: "a chicken" }, context),
    ).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("has no video", async () => {
    const codex = provider(vi.fn() as never);
    expect(codex.capabilities).toMatchObject({ images: true, video: false });
    await expect(codex.generateVideo()).rejects.toMatchObject({ code: "unsupported" });
  });
});
