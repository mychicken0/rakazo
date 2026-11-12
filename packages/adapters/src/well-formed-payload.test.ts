import { describe, expect, it } from "vitest";
import { clipToolResultText } from "./pi-runtime-limits.js";
import { wellFormedValue, withWellFormedPayload } from "./well-formed-payload.js";

const cutEmoji = "score 🎉".slice(0, 7);

describe("well-formed request bodies", () => {
  it("replaces half an emoji left by a character cut, leaving whole ones", () => {
    const body = { input: [{ content: [{ type: "input_text", text: cutEmoji }] }], note: "ok 🎉" };
    const clean = wellFormedValue(body);
    expect(clean.input[0]?.content[0]?.text).toBe("score �");
    expect(clean.note).toBe("ok 🎉");
    expect(JSON.stringify(clean)).not.toMatch(/\\ud8/);
  });

  it("returns the same body when every string is already well-formed", () => {
    const body = { input: [{ text: "สวัสดี 🎉" }] };
    expect(wellFormedValue(body)).toBe(body);
  });

  it("cleans the body after an earlier hook and keeps that hook's change", async () => {
    const options = withWellFormedPayload<{
      onPayload: (payload: unknown, model: never) => unknown;
    }>({
      onPayload: (payload: unknown) => ({ ...(payload as object), extra: cutEmoji }),
    });
    const out = (await options.onPayload({ text: "fine" }, undefined as never)) as Record<
      string,
      string
    >;
    expect(out).toEqual({ text: "fine", extra: "score �" });
  });

  it("leaves the request alone when nothing needs cleaning", async () => {
    const options = withWellFormedPayload<{
      onPayload: (payload: unknown, model: never) => unknown;
    }>(undefined);
    expect(await options.onPayload({ text: "fine" }, undefined as never)).toBeUndefined();
  });

  it("cuts a long tool result before an emoji rather than through it", () => {
    expect(clipToolResultText("ab🎉cd", 3)).toBe("ab…");
    expect(clipToolResultText("ab🎉cd", 4)).toBe("ab🎉…");
  });
});
