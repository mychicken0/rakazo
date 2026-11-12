import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import { attachedImagePreview, fileTools } from "./run-tools-files.js";

async function png(width: number, height: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .png()
      .toBuffer(),
  );
}

function ctx(bytes: Uint8Array, acceptsImages = true) {
  return {
    deps: { sandbox: { readFile: vi.fn(async () => bytes) } },
    bot: { id: "bot-1" },
    context: { spaceId: "space-1" },
    computer: { mode: "shared", acceptsImages, get: vi.fn(async () => ({ id: "c1" })) },
  } as never;
}
const call = (path: string) => ({ name: "read_file", args: { path }, executionId: "e1" }) as never;

type Result = {
  kind: string;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
};

describe("read_file on an image", () => {
  it("shows a small image to the model as it is", async () => {
    const bytes = await png(40, 20);
    const result = (await fileTools.read_file!(ctx(bytes), call("frames/fr1.png"))) as Result;
    expect(result.kind).toBe("agent_tool_result");
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({
      path: "frames/fr1.png",
      width: 40,
      height: 20,
    });
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(Buffer.from(result.content[1]!.data!, "base64").equals(Buffer.from(bytes))).toBe(true);
  });

  it("shrinks a big image to what vision models accept", async () => {
    const result = (await fileTools.read_file!(
      ctx(await png(4000, 1000)),
      call("big.png"),
    )) as Result;
    const shown = Buffer.from(result.content[1]!.data!, "base64");
    const meta = await sharp(shown).metadata();
    expect(result.content[1]!.mimeType).toBe("image/jpeg");
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(500);
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({
      width: 4000,
      shownAs: "a smaller JPEG copy",
    });
  });

  it("says when the bot's model cannot see", async () => {
    const result = await fileTools.read_file!(ctx(await png(4, 4), false), call("a.jpg"));
    expect(result).toEqual({ error: MODEL_CANNOT_SEE_MESSAGE, path: "a.jpg" });
  });

  it("reports a file that is not really an image", async () => {
    const result = await fileTools.read_file!(ctx(new TextEncoder().encode("nope")), call("a.png"));
    expect(result).toEqual({ error: "this file could not be read as an image", path: "a.png" });
  });
});

describe("attachedImagePreview", () => {
  it("draws an SVG the way a browser shows it", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
    );
    const preview = await attachedImagePreview("logo.svg", svg);
    const meta = await sharp(preview!).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBeGreaterThanOrEqual(200);
  });

  it("shrinks a large picture and ignores files that are not pictures", async () => {
    const preview = await attachedImagePreview("big.png", await png(3000, 1500));
    expect((await sharp(preview!).metadata()).width).toBe(1024);
    expect(await attachedImagePreview("notes.txt", new TextEncoder().encode("hi"))).toBeUndefined();
    expect(
      await attachedImagePreview("broken.png", new TextEncoder().encode("nope")),
    ).toBeUndefined();
  });
});
