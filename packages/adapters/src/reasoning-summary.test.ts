import { describe, expect, it } from "vitest";
import { withDetailedReasoningSummary } from "./reasoning-summary.js";

async function send(options: { onPayload?: unknown }, payload: unknown) {
  const hook = options.onPayload as (payload: unknown, model: never) => Promise<unknown>;
  return hook(payload, undefined as never);
}

describe("withDetailedReasoningSummary", () => {
  it("asks for the detailed summary where the request asks for the automatic one", async () => {
    const options = withDetailedReasoningSummary({});
    expect(await send(options, { reasoning: { effort: "high", summary: "auto" } })).toEqual({
      reasoning: { effort: "high", summary: "detailed" },
    });
  });

  it("leaves requests without a summary alone", async () => {
    const options = withDetailedReasoningSummary({});
    expect(await send(options, { reasoning: { effort: "none" } })).toBeUndefined();
    expect(await send(options, { messages: [] })).toBeUndefined();
  });

  it("runs after a hook that was already there", async () => {
    const options = withDetailedReasoningSummary({
      onPayload: async () => ({ reasoning: { summary: "auto" }, replaced: true }),
    });
    expect(await send(options, {})).toEqual({
      reasoning: { summary: "detailed" },
      replaced: true,
    });
  });
});
