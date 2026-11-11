import { describe, expect, it } from "vitest";
import { formatCallDuration, toolCallView } from "./tool-call-view";

describe("toolCallView", () => {
  it("shows a shell call as its command, folder and output", () => {
    const view = toolCallView({
      input: JSON.stringify({ command: "pwd; ls", cwd: "/work" }),
      output: JSON.stringify({ stdout: "/work\n", stderr: "", code: 0 }),
      durationMs: 240,
    });
    expect(view).toEqual({
      summary: "$ pwd; ls",
      command: "pwd; ls",
      cwd: "/work",
      fields: [],
      output: { kind: "shell", stdout: "/work\n", stderr: "", exitCode: 0 },
    });
  });

  it("lists other arguments and object results as fields", () => {
    const view = toolCallView({
      input: JSON.stringify({ message: "On it", urgent: true }),
      output: JSON.stringify({ ok: true, note: "Posted" }),
    });
    expect(view.summary).toBe("On it");
    expect(view.fields).toEqual([
      { key: "message", value: "On it", code: false },
      { key: "urgent", value: "true", code: true },
    ]);
    expect(view.output).toEqual({
      kind: "fields",
      fields: [
        { key: "ok", value: "true", code: true },
        { key: "note", value: "Posted", code: false },
      ],
    });
  });

  it("falls back to the raw text when the stored input is not JSON", () => {
    const view = toolCallView({ input: "not json… (20 more characters)", output: "plain" });
    expect(view.summary).toBe("");
    expect(view.fields).toEqual([
      { key: "input", value: "not json… (20 more characters)", code: true },
    ]);
    expect(view.output).toEqual({ kind: "text", text: "plain" });
  });
});

describe("formatCallDuration", () => {
  it("reads at a glance", () => {
    expect(formatCallDuration(undefined)).toBeUndefined();
    expect(formatCallDuration(240)).toBe("240 ms");
    expect(formatCallDuration(3_240)).toBe("3.2 s");
    expect(formatCallDuration(25_000)).toBe("25 s");
    expect(formatCallDuration(65_000)).toBe("1 min 5 s");
  });
});
