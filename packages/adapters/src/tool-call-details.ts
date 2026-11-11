import type { AgentToolCompletion } from "@rakazo/adapter-kit";
import { formatToolCallDetail } from "@rakazo/core";
import type { ReplyState } from "./run-context.js";
import { toolResultError } from "./tool-result-error.js";

/** The text a tool returned, with images named rather than embedded. */
function resultText(result: unknown): string | undefined {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part) => {
      const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
      if (type === "text" && typeof text === "string") return text;
      return type === "image" ? "[image]" : "";
    })
    .filter(Boolean)
    .join("\n");
}

function errorText(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}

/** Remembers a call's input so its step can show it. Returns the detail to show now. */
export function recordToolCallInput(
  reply: ReplyState,
  executionId: string,
  input: unknown,
): string | undefined {
  reply.toolInputs.set(executionId, input);
  return formatToolCallDetail({ input });
}

/** Remembers how a call ended. Returns the input and output to show on its step. */
export function recordToolCallResult(
  reply: ReplyState,
  completion: AgentToolCompletion,
): string | undefined {
  const error =
    completion.error === undefined ? toolResultError(completion.result) : completion.error;
  const detail = formatToolCallDetail({
    input: reply.toolInputs.get(completion.executionId),
    output: completion.paused ? "Waiting for approval." : (resultText(completion.result) ?? ""),
    error: errorText(error),
    durationMs: completion.durationMs,
  });
  if (detail) reply.toolDetails.set(completion.executionId, detail);
  return detail;
}
