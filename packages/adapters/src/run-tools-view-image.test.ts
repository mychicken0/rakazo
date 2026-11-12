import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import { fileTools } from "./run-tools-files.js";

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
