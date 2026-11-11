import type { ThreadMessage } from "@rakazo/contracts";

type ToolStep = Extract<ThreadMessage["blocks"][number], { kind: "steps" }>["steps"][number];
export type ToolCall = NonNullable<ToolStep["calls"]>[number];

export type ToolCallField = { key: string; value: string; code: boolean };

/** How a call reads at a glance and in full, built from its stored JSON text. */
export type ToolCallView = {
  /** One line for the folded row: the command, message, address or first value. */
  summary: string;
  /** A shell command, shown as a prompt line instead of a field list. */
  command?: string;
  cwd?: string;
  /** The other arguments, one row each. */
  fields: ToolCallField[];
  output?: ToolCallOutput;
};

export type ToolCallOutput =
  | { kind: "shell"; stdout: string; stderr: string; exitCode?: number }
  | { kind: "fields"; fields: ToolCallField[] }
  | { kind: "text"; text: string };

const SUMMARY_KEYS = ["command", "message", "text", "query", "url", "path", "file", "name"];

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function field(key: string, value: unknown): ToolCallField {
  if (typeof value === "string") return { key, value, code: value.includes("\n") };
  return { key, value: JSON.stringify(value, null, 2) ?? String(value), code: true };
}

function oneLine(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function outputView(call: ToolCall): ToolCallOutput | undefined {
  if (call.output === undefined) return undefined;
  const parsed = parseJson(call.output);
  if (isRecord(parsed) && ("stdout" in parsed || "stderr" in parsed)) {
    const code = parsed.code ?? parsed.exitCode;
    return {
      kind: "shell",
      stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
      stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
      ...(typeof code === "number" ? { exitCode: code } : {}),
    };
  }
  if (isRecord(parsed)) {
    return {
      kind: "fields",
      fields: Object.entries(parsed).map(([key, value]) => field(key, value)),
    };
  }
  return { kind: "text", text: call.output };
}

export function toolCallView(call: ToolCall): ToolCallView {
  const input = parseJson(call.input);
  const args = isRecord(input) ? input : undefined;
  const command = typeof args?.command === "string" ? args.command : undefined;
  const cwd = command && typeof args?.cwd === "string" ? args.cwd : undefined;
  const fields = args
    ? Object.entries(args)
        .filter(([key]) => !(command && (key === "command" || key === "cwd")))
        .map(([key, value]) => field(key, value))
    : call.input
      ? [{ key: "input", value: call.input, code: true }]
      : [];
  const summaryKey = SUMMARY_KEYS.find((key) => typeof args?.[key] === "string");
  const firstText = args && Object.values(args).find((value) => typeof value === "string");
  const summary = command
    ? `$ ${oneLine(command)}`
    : summaryKey
      ? oneLine(String(args?.[summaryKey]))
      : typeof firstText === "string"
        ? oneLine(firstText)
        : "";
  const output = outputView(call);
  return {
    summary,
    ...(command ? { command } : {}),
    ...(cwd ? { cwd } : {}),
    fields,
    ...(output ? { output } : {}),
  };
}

/** Milliseconds as a short duration: "240 ms", "3.2 s", "1 min 5 s". */
export function formatCallDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
