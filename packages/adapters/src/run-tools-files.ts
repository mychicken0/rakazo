import type { MessageBlock } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES, isAttachmentImageMimeType } from "@rakazo/contracts";
import {
  attachmentExtensionForMimeType,
  inferAttachmentMimeType,
  isBackgroundRunTrigger,
  messageBlockForArtifact,
} from "@rakazo/core";
import type { Artifact, Prisma } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { resolveBotWorkspacePath } from "./computer-support.js";
import { desktopGuardApplies, desktopProtectionGuardMessage } from "./desktop-command-guard.js";
import { protectedActivateScriptWriteRefusal } from "./desktop-guard-words.js";
import { generateMediaFromTool } from "./media-generation-tools.js";
import { mediaDelivery, scheduleMediaPoll } from "./media-video-poll.js";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import type { RunContext } from "./run-context.js";
import { persistMessageInTransaction, runLeaseFor } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { recordComputerAction } from "./run-tools-computer.js";
import { viewWorkspaceVideo } from "./run-tools-media-view.js";
import { attachWorkspaceFileToThread } from "./thread-artifacts.js";
import { textContentArg } from "./tool-text.js";
import type { RunWorkspace } from "./workspace-file-tools.js";
import { listFilesFromTool, readFileFromTool, renderPlotFromTool } from "./workspace-file-tools.js";

export type AttachmentBlock = Extract<MessageBlock, { kind: "image" | "file" }>;

function runWorkspace(ctx: RunContext, call: ToolCall): RunWorkspace {
  return {
    botId: ctx.bot.id,
    computerMode: ctx.computer.mode,
    computer: () => ctx.computer.get("tool", call.name),
    markDirty: () => ctx.computer.checkpoint.markDirty(),
    context: ctx.context,
    runSecrets: ctx.secrets,
  };
}

/** Generate an image or video, or with recoverOnly, only resume a job an earlier attempt started. */
export async function callMediaTool(ctx: RunContext, call: ToolCall, recoverOnly = false) {
  const { deps, run, thread, context } = ctx;
  const { name, args, executionId, applied } = call;
  const mediaGeneration = ctx.providers.mediaGeneration;
  if (
    (name !== "generate_image" && name !== "generate_video") ||
    isBackgroundRunTrigger(run.trigger) ||
    !mediaGeneration ||
    !deps.artifacts
  )
    return { error: "Media generation is unavailable." };
  const result = await generateMediaFromTool({
    name,
    args,
    executionId: applied?.effect.id ?? executionId,
    recoverOnly,
    provider: mediaGeneration,
    prisma: deps.prisma,
    context,
    run,
    threadGeneration: thread.historyCompactionGeneration,
    ...mediaDelivery({ ...deps, artifacts: deps.artifacts }, run, {
      providerId: mediaGeneration.id,
      groupId: thread.groupId ?? undefined,
      operationId: executionId,
    }),
  });
  // The bot gets its own copy too, so it can edit, convert or reuse what it made.
  if (result && "artifactId" in result && result.artifactId && result.status === "completed") {
    const path = await copyGeneratedMedia(ctx, call, result.artifactId);
    if (path) return { ...result, path };
  }
  // The run may end before the video does, so a background poll posts it when it is ready.
  if (
    result &&
    "jobId" in result &&
    result.jobId &&
    "status" in result &&
    (result.status === "queued" || result.status === "running")
  )
    await scheduleMediaPoll(deps.jobs, result.jobId);
  return result;
}

async function generateMedia(ctx: RunContext, call: ToolCall) {
  return call.finish(await callMediaTool(ctx, call));
}

/** Workspace files, attachments, plots and generated media. */
export const fileTools: ToolHandlers = {
  async list_files(ctx, call) {
    const { deps } = ctx;
    const { args } = call;
    const workspace = runWorkspace(ctx, call);
    return listFilesFromTool(deps.sandbox, workspace, args);
  },
  async read_file(ctx, call) {
    const { deps } = ctx;
    const { args } = call;
    const mediaPath = String(args.path ?? "");
    const mediaType = inferAttachmentMimeType(mediaPath);
    if (isAttachmentImageMimeType(mediaType)) return viewWorkspaceImage(ctx, call, mediaPath);
    // The runtime gives models text and images only, so a video arrives as frames.
    if (mediaType.startsWith("video/")) return viewWorkspaceVideo(ctx, call, mediaPath);
    const workspace = runWorkspace(ctx, call);
    return readFileFromTool(deps.sandbox, workspace, args);
  },
  async write_file(ctx, call) {
    const { deps, bot, context } = ctx;
    const { name, args } = call;
    const filePath = String(args.path ?? "notes/result.txt");
    if (desktopGuardApplies(ctx.computer)) {
      const activateRefusal = protectedActivateScriptWriteRefusal(filePath);
      if (activateRefusal) {
        return call.finish({ error: desktopProtectionGuardMessage(activateRefusal) });
      }
    }
    const content = new TextEncoder().encode(textContentArg(args.content, ""));
    ctx.computer.checkpoint.markDirty();
    try {
      await deps.sandbox.writeFile(
        await ctx.computer.get("tool", name),
        { path: resolveBotWorkspacePath(ctx.computer.mode, bot.id, filePath), content },
        context,
      );
    } catch (error) {
      await recordComputerAction(ctx, call, "write_file", filePath, {
        error: error instanceof Error ? error.message : "could not write file",
      });
      throw error;
    }
    await recordComputerAction(ctx, call, "write_file", filePath, { bytes: content.byteLength });
    return call.finish({ ok: true, path: filePath });
  },
  generate_image: generateMedia,
  generate_video: generateMedia,
  async render_plot(ctx, call) {
    const { deps, run } = ctx;
    const { args, executionId } = call;
    const workspace = runWorkspace(ctx, call);
    return renderPlotFromTool(deps, run, args, executionId, workspace, call.finish);
  },
  async attach_file(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const filePath = String(call.args.path ?? "");
    const fail = async (error: string) => {
      await recordComputerAction(ctx, call, "attach_file", filePath, { error });
      return call.finish({ error, path: filePath });
    };
    const read = await readWorkspaceFile(ctx, call, filePath);
    if ("error" in read) return fail(read.error);
    try {
      // Background runs post no message (publishMessage drops attachment blocks).
      const background = isBackgroundRunTrigger(run.trigger);
      const lease = runLeaseFor(deps, run.id);
      let committed: Awaited<ReturnType<typeof persistMessageInTransaction>> | undefined;
      const saved = await saveWorkspaceFile(
        ctx,
        call,
        filePath,
        read.bytes,
        { botId: bot.id, groupId: thread.groupId ?? undefined },
        {
          name: typeof call.args.name === "string" ? call.args.name : undefined,
          description:
            typeof call.args.description === "string" ? call.args.description : undefined,
        },
        // The message commits with the artifact row, so a post that fails leaves no artifact
        // the user was never shown.
        background
          ? undefined
          : async (tx, artifact) => {
              committed = await persistMessageInTransaction(
                tx,
                run,
                "bot",
                [messageBlockForArtifact(artifact)],
                run.trigger === "bot_message" ? false : undefined,
                undefined,
                false,
                lease,
              );
            },
      );
      if (committed)
        await deps.events
          .notify(run.threadId, committed.eventSeq, committed.firstResponseRunId)
          .catch((error) => getLogger().error("thread message realtime notification", error));
      await recordComputerAction(ctx, call, "attach_file", filePath);
      const finished = await call.finish({
        ok: true,
        artifactId: saved.artifactId,
        path: filePath,
      });
      // A bot that can see gets the picture it just sent, so a broken render or a bad trace is
      // caught before it tells the user the work looks right.
      const preview = ctx.computer.acceptsImages
        ? await attachedImagePreview(filePath, read.bytes)
        : undefined;
      if (!preview) return finished;
      return {
        kind: "agent_tool_result",
        content: [
          {
            type: "text",
            text: `${JSON.stringify(finished)}\nThis is what the user now sees. Check it before calling the work done; if it is wrong, fix it and attach again under the same name.`,
          },
          { type: "image", data: preview.toString("base64"), mimeType: "image/png" },
        ],
        details: finished,
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "could not attach file");
    }
  },
};

/** A small PNG of an attached image or SVG for the model, or undefined for anything else. */
export async function attachedImagePreview(
  filePath: string,
  bytes: Uint8Array,
): Promise<Buffer | undefined> {
  const type = inferAttachmentMimeType(filePath);
  if (!isAttachmentImageMimeType(type) && type !== "image/svg+xml") return undefined;
  try {
    const { default: sharp } = await import("sharp");
    // An SVG is drawn by librsvg, as browsers would show it; transparency sits on white.
    return await sharp(bytes, { limitInputPixels: 268_402_689, density: 144 })
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .png()
      .toBuffer();
  } catch {
    return undefined;
  }
}

/** The largest image read from a workspace; bigger photos are not something to look at whole. */
const MAX_VIEW_IMAGE_BYTES = 40 * 1024 * 1024;
/** What every vision model accepts: under ~3.5 MB and 2000 px on the long side. */
const VIEW_IMAGE_MAX_EDGE = 2000;
const VIEW_IMAGE_MAX_BYTES = 3_500_000;

/**
 * Shows an image file from the workspace to the model, shrunk to what vision models accept, so a
 * bot can look at frames, renders and photos it saved instead of only reading their bytes.
 */
async function viewWorkspaceImage(ctx: RunContext, call: ToolCall, filePath: string) {
  const { deps, bot, context } = ctx;
  if (!ctx.computer.acceptsImages) return { error: MODEL_CANNOT_SEE_MESSAGE, path: filePath };
  let bytes: Uint8Array;
  try {
    bytes = await deps.sandbox.readFile(
      await ctx.computer.get("tool", call.name),
      resolveBotWorkspacePath(ctx.computer.mode, bot.id, filePath),
      context,
      { maxBytes: MAX_VIEW_IMAGE_BYTES },
    );
  } catch {
    return { error: "file not found, unreadable, or larger than 40 MB", path: filePath };
  }
  try {
    const { default: sharp } = await import("sharp");
    // Animated GIFs show their first frame; orientation follows the photo's EXIF.
    const image = sharp(bytes, { limitInputPixels: 268_402_689 }).rotate();
    const meta = await image.metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    const fits =
      bytes.byteLength <= VIEW_IMAGE_MAX_BYTES &&
      Math.max(width, height) <= VIEW_IMAGE_MAX_EDGE &&
      ["png", "jpeg", "webp"].includes(meta.format ?? "");
    const shown = fits
      ? { data: Buffer.from(bytes), mimeType: `image/${meta.format}` }
      : {
          data: await image
            .resize(VIEW_IMAGE_MAX_EDGE, VIEW_IMAGE_MAX_EDGE, {
              fit: "inside",
              withoutEnlargement: true,
            })
            .flatten({ background: "white" })
            .jpeg({ quality: 85 })
            .toBuffer(),
          mimeType: "image/jpeg",
        };
    const details = {
      path: filePath,
      width,
      height,
      bytes: bytes.byteLength,
      ...(fits ? {} : { shownAs: "a smaller JPEG copy" }),
    };
    return {
      kind: "agent_tool_result",
      content: [
        { type: "text", text: JSON.stringify(details) },
        { type: "image", data: shown.data.toString("base64"), mimeType: shown.mimeType },
      ],
      details,
    };
  } catch {
    return { error: "this file could not be read as an image", path: filePath };
  }
}

/**
 * Copies a generated image or finished video into the bot's workspace under `generated/`, and
 * returns that path, or undefined when it cannot (the chat still has the file either way).
 */
async function copyGeneratedMedia(
  ctx: RunContext,
  call: ToolCall,
  artifactId: string,
): Promise<string | undefined> {
  const { deps, bot, context } = ctx;
  if (!deps.artifacts) return undefined;
  try {
    const row = await deps.prisma.artifact.findUnique({
      where: { id: artifactId },
      select: { storageKey: true, mimeType: true, spaceId: true },
    });
    if (!row || row.spaceId !== context.spaceId) return undefined;
    const bytes = await deps.artifacts.get(row.storageKey, context);
    const path = `generated/${artifactId}${attachmentExtensionForMimeType(row.mimeType)}`;
    ctx.computer.checkpoint.markDirty();
    await deps.sandbox.writeFile(
      await ctx.computer.get("tool", call.name),
      { path: resolveBotWorkspacePath(ctx.computer.mode, bot.id, path), content: bytes },
      context,
    );
    return path;
  } catch (error) {
    getLogger().warn("generated media copy failed", { error: String(error) });
    return undefined;
  }
}

/** Read a file from this bot's computer that can become an attachment, without saving it. */
export async function readWorkspaceFile(
  ctx: RunContext,
  call: ToolCall,
  filePath: string,
): Promise<{ error: string } | { bytes: Uint8Array }> {
  const { deps, bot, context } = ctx;
  if (!deps.artifacts) return { error: "artifact storage unavailable" };
  let bytes: Uint8Array;
  try {
    bytes = await deps.sandbox.readFile(
      await ctx.computer.get("tool", call.name),
      resolveBotWorkspacePath(ctx.computer.mode, bot.id, filePath),
      context,
      { maxBytes: deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES },
    );
  } catch {
    return { error: "file not found or unreadable" };
  }
  if (!inferAttachmentMimeType(filePath)) return { error: "unsupported attachment type" };
  return { bytes };
}

/**
 * Save a file read from this bot's computer as an attachment of the chat that will show it:
 * a bot's own chat, or a group's.
 */
export async function saveWorkspaceFile(
  ctx: RunContext,
  call: ToolCall,
  filePath: string,
  bytes: Uint8Array,
  owner: { botId: string; groupId?: string },
  meta: { name?: string; description?: string } = {},
  onAttached?: (tx: Prisma.TransactionClient, artifact: Artifact) => Promise<void>,
): Promise<{ artifactId: string; block: AttachmentBlock }> {
  const { deps, run } = ctx;
  if (!deps.artifacts) throw new Error("artifact storage unavailable");
  return attachWorkspaceFileToThread(
    { prisma: deps.prisma, artifacts: deps.artifacts, maxUploadSizeBytes: deps.maxUploadSizeBytes },
    {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: owner.botId,
      groupId: owner.groupId,
      runId: run.id,
      filePath,
      bytes,
      operationId: call.executionId,
      name: meta.name,
      description: meta.description,
      onAttached,
    },
  );
}
