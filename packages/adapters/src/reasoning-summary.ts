type PayloadHook = (payload: unknown, model: never) => unknown;

/** A request body asking for an automatic reasoning summary now asks for the detailed one. */
function withDetailedSummary(payload: unknown): unknown {
  const reasoning = (payload as { reasoning?: unknown } | null)?.reasoning;
  if (!reasoning || typeof reasoning !== "object") return undefined;
  if ((reasoning as { summary?: unknown }).summary !== "auto") return undefined;
  return { ...(payload as object), reasoning: { ...reasoning, summary: "detailed" } };
}

/**
 * Stream options that ask for the fuller reasoning summary where the request already asks for
 * one, after any onPayload hook already there, so the chat can show how the bot reasoned.
 */
export function withDetailedReasoningSummary<O extends object>(options: O | undefined): O {
  const previous = (options as { onPayload?: PayloadHook } | undefined)?.onPayload;
  return {
    ...(options ?? {}),
    onPayload: async (payload: unknown, model: never) => {
      const replaced = previous ? await previous(payload, model) : undefined;
      return withDetailedSummary(replaced ?? payload) ?? replaced;
    },
  } as O;
}
