import { t } from "@lingui/core/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import { previewMessageText as previewText } from "@rakazo/core";
import type { LargeUploadResult } from "../../lib/large-upload";

export type PendingAttachment = {
  id: string;
  threadKey: string;
  file: File;
  previewUrl?: string;
  /** A file over the chat limit, already uploading to shared storage in the background. */
  large?: {
    upload: Promise<LargeUploadResult>;
    abort: AbortController;
    progress: number;
    failed?: boolean;
  };
};

/** Identity colour for bots the roster no longer knows about. */
export const FALLBACK_BOT_COLOR = "#85858A";

export function previewMessageText(message: ThreadMessage): string {
  return previewText(message, { photo: t`Photo`, attachment: t`Attachment`, message: t`Message` });
}
