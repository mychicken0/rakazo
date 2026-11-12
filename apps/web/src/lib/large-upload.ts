import type { RpcClient } from "./rpc";

/** Chunk size for resumable uploads: a multiple of 256 KiB, as the storage service requires. */
export const LARGE_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_RETRIES = 6;

export type LargeUploadResult = { name: string; size: number; link: string };

type Fetch = typeof fetch;

function nextOffset(response: Response): number {
  // "bytes=0-1234" names what the service holds; no header means nothing yet.
  const match = /bytes=0-(\d+)/.exec(response.headers.get("range") ?? "");
  return match ? Number(match[1]) + 1 : 0;
}

async function fileId(response: Response): Promise<string> {
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("Upload finished without a file id");
  return body.id;
}

/**
 * Sends a file over the chat limit straight to the deployment's shared storage, chunk by chunk,
 * resuming from what the service already holds after a dropped connection.
 */
export async function uploadLargeFile(
  rpc: Pick<RpcClient, "largeFiles">,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
): Promise<LargeUploadResult> {
  const { uploadUrl } = await rpc.largeFiles.start({
    name: file.name,
    size: file.size,
    ...(file.type ? { mimeType: file.type } : {}),
  });
  const total = file.size;
  let offset = 0;
  let failures = 0;
  let id: string | undefined;
  while (id === undefined) {
    signal.throwIfAborted();
    const end = Math.min(offset + LARGE_UPLOAD_CHUNK_BYTES, total);
    try {
      const response = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: { "content-range": `bytes ${offset}-${end - 1}/${total}` },
        body: file.slice(offset, end),
        signal,
      });
      if (response.status === 308) {
        offset = nextOffset(response);
        failures = 0;
        onProgress(offset / total);
        continue;
      }
      if (response.ok) {
        id = await fileId(response);
        break;
      }
      if (response.status < 500 && response.status !== 429)
        throw Object.assign(new Error(`Upload refused (${response.status})`), { fatal: true });
    } catch (error) {
      if (signal.aborted || (error as { fatal?: boolean }).fatal) throw error;
    }
    failures += 1;
    if (failures > MAX_RETRIES) throw new Error("Upload kept failing; check the connection");
    await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** failures)));
    // Ask how much arrived before the failure, and continue from there.
    const status = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { "content-range": `bytes */${total}` },
      signal,
    }).catch(() => undefined);
    if (status?.status === 308) offset = nextOffset(status);
    else if (status?.ok) id = await fileId(status);
  }
  onProgress(1);
  return rpc.largeFiles.finish({ fileId: id });
}

export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
