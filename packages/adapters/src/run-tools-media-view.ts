import { randomUUID } from "node:crypto";
import { resolveBotWorkspacePath } from "./computer-support.js";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";

/** Frames shown for one video: enough to follow it, few enough to stay cheap. */
const VIDEO_FRAMES = 8;
const FRAME_WIDTH = 1024;
const MEDIA_COMMAND_TIMEOUT_MS = 180_000;
type Probe = { duration: number; width?: number; height?: number };

async function runInComputer(
  ctx: RunContext,
  call: ToolCall,
  script: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const computer = await ctx.computer.get("tool", call.name);
  let stdout = "";
  let stderr = "";
  let code = -1;
  for await (const event of ctx.deps.sandbox.execute(
    computer,
    { argv: ["bash", "-c", script, "rakazo-media", ...args], timeoutMs: MEDIA_COMMAND_TIMEOUT_MS },
    ctx.context,
  )) {
    if (event.type === "stdout") stdout += event.data;
    else if (event.type === "stderr") stderr += event.data;
    else if (event.type === "exit") code = event.code;
  }
  return { stdout, stderr, code };
}

async function probe(ctx: RunContext, call: ToolCall, file: string): Promise<Probe | string> {
  const result = await runInComputer(
    ctx,
    call,
    'command -v ffprobe >/dev/null || { echo "ffmpeg is not installed on this computer" >&2; exit 127; }; ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json -- "$1"',
    [file],
  );
  if (result.code !== 0) return result.stderr.trim().slice(0, 300) || "could not read this file";
  try {
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    return {
      duration: Number(parsed.format?.duration ?? 0),
      width: video?.width,
      height: video?.height,
    };
  } catch {
    return "could not read this file";
  }
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** A video for a model that sees only images: evenly spaced frames with their times. */
export async function viewWorkspaceVideo(ctx: RunContext, call: ToolCall, filePath: string) {
  if (!ctx.computer.acceptsImages) return { error: MODEL_CANNOT_SEE_MESSAGE, path: filePath };
  const file = resolveBotWorkspacePath(ctx.computer.mode, ctx.bot.id, filePath);
  const info = await probe(ctx, call, file).catch(() => "could not read this file");
  if (typeof info === "string") return { error: info, path: filePath };
  const times = Array.from(
    { length: info.duration > 0 ? VIDEO_FRAMES : 1 },
    (_, i) => (info.duration * (i + 0.5)) / VIDEO_FRAMES,
  );
  const dir = `.rakazo-media/${randomUUID()}`;
  const stored = resolveBotWorkspacePath(ctx.computer.mode, ctx.bot.id, dir);
  const frames: Array<{ type: "image"; data: string; mimeType: string }> = [];
  try {
    const grab = await runInComputer(
      ctx,
      call,
      `mkdir -p "$2"; i=0; for t in $3; do i=$((i+1)); ffmpeg -v error -nostdin -ss "$t" -i "$1" -frames:v 1 -vf "scale='min(${FRAME_WIDTH},iw)':-2" -q:v 4 -y "$2/f$i.jpg" || exit 1; done`,
      [file, stored, times.map((t) => t.toFixed(2)).join(" ")],
    );
    if (grab.code !== 0)
      return { error: "frames could not be taken from this video", path: filePath };
    for (let i = 1; i <= times.length; i++) {
      const bytes = await ctx.deps.sandbox.readFile(
        await ctx.computer.get("tool", call.name),
        `${stored}/f${i}.jpg`,
        ctx.context,
      );
      frames.push({
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: "image/jpeg",
      });
    }
  } finally {
    await runInComputer(ctx, call, 'rm -rf -- "$1"', [stored]).catch(() => undefined);
  }
  const details = {
    path: filePath,
    duration: clock(info.duration),
    ...(info.width ? { size: `${info.width}x${info.height}` } : {}),
    frames: times.map((t, i) => `frame ${i + 1} at ${clock(t)}`),
    more: "for a closer look at a moment, extract it with ffmpeg and read_file the image",
  };
  return {
    kind: "agent_tool_result",
    content: [{ type: "text", text: JSON.stringify(details) }, ...frames],
    details,
  };
}
