/**
 * Files over the chat upload limit go straight from the browser to a shared Google Drive folder:
 * the server opens a resumable upload session for the deployment's account and hands the browser
 * its URL, so the bytes never pass through this server or the proxy in front of it.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
/** Drive's own per-file ceiling. */
export const LARGE_FILE_MAX_BYTES = 5 * 1024 ** 4;

export type LargeFileDriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
  /** The web app's origin; the browser may only use the session from there. */
  origin: string;
  fetch?: typeof fetch;
};

export type LargeFile = { id: string; name: string; size: number; link: string };

export class LargeFileError extends Error {}

/** A file name safe to store: no path parts or control characters, within Drive's length. */
export function largeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes.
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "file").slice(0, 255);
}

export class LargeFileDrive {
  private token?: { value: string; expiresAt: number };
  private readonly fetch: typeof fetch;

  constructor(private readonly config: LargeFileDriveConfig) {
    this.fetch = config.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // The error body can echo request details; report the status only.
    if (!res.ok) throw new LargeFileError(`Large file storage sign-in failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new LargeFileError("Large file storage sign-in failed");
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  /** Opens an upload session in the shared folder and returns the URL the browser uploads to. */
  async startUpload(input: { name: string; size: number; mimeType?: string }): Promise<string> {
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > LARGE_FILE_MAX_BYTES)
      throw new LargeFileError("Unsupported file size");
    const res = await this.fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": input.mimeType || "application/octet-stream",
        "x-upload-content-length": String(input.size),
        // A session opened with an Origin answers that origin's browser requests (CORS).
        origin: this.config.origin,
      },
      body: JSON.stringify({ name: largeFileName(input.name), parents: [this.config.folderId] }),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    const location = res.headers.get("location");
    if (!res.ok || !location)
      throw new LargeFileError(`Could not start the upload (${res.status})`);
    return location;
  }

  /** A finished upload, only when it is in the shared folder. */
  async finished(fileId: string): Promise<LargeFile> {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new LargeFileError("Unknown file");
    const url = `${FILES_URL}/${fileId}?fields=id,name,size,parents,webViewLink,trashed`;
    const res = await this.fetch(url, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new LargeFileError("Unknown file");
    }
    const file = (await res.json()) as {
      id: string;
      name: string;
      size?: string;
      parents?: string[];
      webViewLink?: string;
      trashed?: boolean;
    };
    if (file.trashed || !file.parents?.includes(this.config.folderId) || !file.webViewLink)
      throw new LargeFileError("Unknown file");
    return { id: file.id, name: file.name, size: Number(file.size ?? 0), link: file.webViewLink };
  }
}

/** Configured from LARGE_FILE_DRIVE_* settings; undefined (feature off) unless all are set. */
export function largeFileDriveFromEnv(
  env: NodeJS.ProcessEnv,
  origin: string,
): LargeFileDrive | undefined {
  const clientId = env.LARGE_FILE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = env.LARGE_FILE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = env.LARGE_FILE_DRIVE_REFRESH_TOKEN?.trim();
  const folderId = env.LARGE_FILE_DRIVE_FOLDER_ID?.trim();
  if (!clientId || !clientSecret || !refreshToken || !folderId) return undefined;
  return new LargeFileDrive({ clientId, clientSecret, refreshToken, folderId, origin });
}
