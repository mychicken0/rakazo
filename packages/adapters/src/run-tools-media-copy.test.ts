import { describe, expect, it, vi } from "vitest";

const generateMediaFromTool = vi.fn();
vi.mock("./media-generation-tools.js", () => ({
  generateMediaFromTool: (...args: unknown[]) => generateMediaFromTool(...args),
}));
vi.mock("./media-video-poll.js", () => ({
  mediaDelivery: () => ({ attach: vi.fn(), publish: vi.fn() }),
  scheduleMediaPoll: vi.fn(),
}));

const { callMediaTool } = await import("./run-tools-files.js");

function ctx(options: { writeFails?: boolean; otherSpace?: boolean } = {}) {
  const writeFile = vi.fn(async () => {
    if (options.writeFails) throw new Error("computer is gone");
  });
  const markDirty = vi.fn();
  const context = { spaceId: "space-1", userId: "user-1", operationId: "op", traceId: "t" };
  return {
    writeFile,
    markDirty,
    ctx: {
      deps: {
        prisma: {
          artifact: {
            findUnique: vi.fn(async () => ({
              storageKey: "key-1",
              mimeType: "image/png",
              spaceId: options.otherSpace ? "space-2" : "space-1",
            })),
          },
        },
        artifacts: { get: vi.fn(async () => new Uint8Array([137, 80, 78, 71])) },
        sandbox: { writeFile },
        jobs: {},
      },
      run: { id: "run-1", trigger: "user", spaceId: "space-1", userId: "user-1" },
      thread: { historyCompactionGeneration: 0, groupId: null },
      bot: { id: "bot-1" },
      context,
      providers: { mediaGeneration: { id: "codex" } },
      computer: {
        mode: "shared",
        get: vi.fn(async () => ({ id: "computer-1" })),
        checkpoint: { markDirty },
      },
    } as never,
  };
}

const call = { name: "generate_image", args: { prompt: "a logo" }, executionId: "exec-1" } as never;

describe("generated media in the bot's workspace", () => {
  it("copies a finished image into generated/ and reports the path", async () => {
    generateMediaFromTool.mockResolvedValueOnce({ status: "completed", artifactId: "art-1" });
    const { ctx: runCtx, writeFile, markDirty } = ctx();
    const result = await callMediaTool(runCtx, call);
    expect(result).toEqual({
      status: "completed",
      artifactId: "art-1",
      path: "generated/art-1.png",
    });
    expect(markDirty).toHaveBeenCalled();
    const [, file] = writeFile.mock.calls[0] as unknown as [
      unknown,
      { path: string; content: Uint8Array },
    ];
    expect(file.path).toContain("generated/art-1.png");
    expect(Array.from(file.content)).toEqual([137, 80, 78, 71]);
  });

  it("still delivers the image when the copy fails", async () => {
    generateMediaFromTool.mockResolvedValueOnce({ status: "completed", artifactId: "art-1" });
    const result = await callMediaTool(ctx({ writeFails: true }).ctx, call);
    expect(result).toEqual({ status: "completed", artifactId: "art-1" });
  });

  it("never copies a file from another space", async () => {
    generateMediaFromTool.mockResolvedValueOnce({ status: "completed", artifactId: "art-1" });
    const { ctx: runCtx, writeFile } = ctx({ otherSpace: true });
    expect(await callMediaTool(runCtx, call)).toEqual({ status: "completed", artifactId: "art-1" });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("leaves errors and queued videos alone", async () => {
    generateMediaFromTool.mockResolvedValueOnce({ error: "Media generation is unavailable." });
    const { ctx: runCtx, writeFile } = ctx();
    expect(await callMediaTool(runCtx, call)).toEqual({
      error: "Media generation is unavailable.",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
