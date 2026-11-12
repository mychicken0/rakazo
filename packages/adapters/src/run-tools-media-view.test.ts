import { describe, expect, it, vi } from "vitest";
import { viewWorkspaceVideo } from "./run-tools-media-view.js";

type Exec = { argv: string[] };

function ctx(options: { probe?: string; acceptsImages?: boolean }) {
  const scripts: string[] = [];
  const execute = vi.fn(async function* (_computer: unknown, request: Exec) {
    const script = request.argv[2]!;
    scripts.push(script);
    if (script.includes("ffprobe")) {
      yield { type: "stdout", data: options.probe ?? "" };
      yield { type: "exit", code: options.probe ? 0 : 1 };
      return;
    }
    yield { type: "exit", code: 0 };
  });
  const readFile = vi.fn(async (_c: unknown, path: string) =>
    new TextEncoder().encode(`bytes of ${path}`),
  );
  return {
    scripts,
    readFile,
    ctx: {
      deps: { sandbox: { execute, readFile } },
      bot: { id: "bot-1" },
      run: { userId: "user-1" },
      context: { spaceId: "space-1", signal: new AbortController().signal },
      computer: {
        mode: "shared",
        acceptsImages: options.acceptsImages ?? true,
        get: vi.fn(async () => ({ id: "c1" })),
      },
    } as never,
  };
}
const call = { name: "read_file", args: {}, executionId: "e1" } as never;
const videoProbe = JSON.stringify({
  format: { duration: "100.0" },
  streams: [{ codec_type: "video", width: 1920, height: 1080 }, { codec_type: "audio" }],
});

describe("read_file on video", () => {
  it("shows eight frames with their times", async () => {
    const { ctx: runCtx, scripts } = ctx({ probe: videoProbe });
    const result = (await viewWorkspaceVideo(runCtx, call, "clip.mp4")) as {
      content: Array<{ type: string; text?: string; mimeType?: string }>;
    };
    const text = JSON.parse(result.content[0]!.text!);
    expect(text).toMatchObject({ duration: "1:40", size: "1920x1080" });
    expect(text.frames).toHaveLength(8);
    expect(text.frames[0]).toBe("frame 1 at 0:06");
    expect(result.content.filter((item) => item.type === "image")).toHaveLength(8);
    // The temporary frames are removed afterwards.
    expect(scripts.filter((script) => script.startsWith("rm -rf"))).toHaveLength(1);
  });

  it("tells a model that cannot see", async () => {
    const result = await viewWorkspaceVideo(ctx({ acceptsImages: false }).ctx, call, "clip.mp4");
    expect(result).toMatchObject({ error: expect.stringContaining("cannot see") });
  });

  it("reports a file ffprobe cannot read", async () => {
    const result = await viewWorkspaceVideo(ctx({}).ctx, call, "broken.mp4");
    expect(result).toMatchObject({ error: expect.any(String), path: "broken.mp4" });
  });
});
