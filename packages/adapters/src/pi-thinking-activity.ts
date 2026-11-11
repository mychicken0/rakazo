import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

/** Observe explicit provider lifecycle markers, before retry/fallback buffering.
 * This observes an exposed stream phase, never hidden compute or a quiet connection.
 * `onReasoning` gets the reasoning summary the provider streamed, once each block ends;
 * the provider's partial message never crosses this boundary.
 */
export function withPiThinkingActivity(
  stream: AssistantMessageEventStream,
  setThinking: (active: boolean) => void,
  onReasoning?: (text: string) => void,
): AssistantMessageEventStream {
  class ThinkingStream extends AssistantMessageEventStream {
    override async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
      let streamed = "";
      const finishReasoning = (summary?: string) => {
        const text = (summary?.trim() || streamed.trim()) ?? "";
        streamed = "";
        if (text) onReasoning?.(text);
      };
      try {
        for await (const event of stream) {
          if (event.type === "thinking_start") {
            streamed = "";
            setThinking(true);
          } else if (event.type === "thinking_delta") {
            streamed += event.delta;
          } else {
            finishReasoning(event.type === "thinking_end" ? event.content : undefined);
            setThinking(false);
          }
          yield event;
        }
      } finally {
        finishReasoning();
        setThinking(false);
      }
    }
    override result(): Promise<AssistantMessage> {
      return stream.result();
    }
  }
  return new ThinkingStream();
}
