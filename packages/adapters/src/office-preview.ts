/**
 * Documents, spreadsheets and slide decks rendered as PDF so every client can show them with its
 * PDF viewer. Conversion runs in a separate document service (a Gotenberg-compatible HTTP API
 * around LibreOffice) on the deployment's own network; files never leave it.
 */

const CONVERT_PATH = "/forms/libreoffice/convert";
const CONVERT_TIMEOUT_MS = 120_000;
/** Recently made previews kept in memory, so reopening a deck is instant. */
const CACHE_ENTRIES = 24;
const CACHE_MAX_BYTES = 256 * 1024 * 1024;

export class OfficePreviewError extends Error {}

export class OfficePreviewConverter {
  private readonly cache = new Map<string, Uint8Array>();
  private cachedBytes = 0;
  private readonly inFlight = new Map<string, Promise<Uint8Array>>();
  private readonly fetch: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    options: { fetch?: typeof fetch } = {},
  ) {
    this.fetch = options.fetch ?? fetch;
  }

  /** The PDF for one stored file; `key` names that exact content, so a new version converts anew. */
  async toPdf(key: string, name: string, bytes: Uint8Array): Promise<Uint8Array> {
    const cached = this.cache.get(key);
    if (cached) {
      // Most recently used goes last; the oldest is evicted first.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const running = this.inFlight.get(key);
    if (running) return running;
    const conversion = this.convert(name, bytes).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, conversion);
    const pdf = await conversion;
    this.remember(key, pdf);
    return pdf;
  }

  private remember(key: string, pdf: Uint8Array) {
    if (pdf.byteLength > CACHE_MAX_BYTES / 4) return;
    this.cache.set(key, pdf);
    this.cachedBytes += pdf.byteLength;
    for (const [oldKey, oldPdf] of this.cache) {
      if (this.cache.size <= CACHE_ENTRIES && this.cachedBytes <= CACHE_MAX_BYTES) break;
      this.cache.delete(oldKey);
      this.cachedBytes -= oldPdf.byteLength;
    }
  }

  private async convert(name: string, bytes: Uint8Array): Promise<Uint8Array> {
    const form = new FormData();
    // LibreOffice picks the importer from the extension, so the stored name is kept as is.
    form.append("files", new Blob([Uint8Array.from(bytes)]), name.split(/[\\/]/).pop() || "document");
    let res: Response;
    try {
      res = await this.fetch(new URL(CONVERT_PATH, this.baseUrl), {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
      });
    } catch {
      throw new OfficePreviewError("The document service is unavailable");
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new OfficePreviewError(`The document could not be rendered (${res.status})`);
    }
    const pdf = new Uint8Array(await res.arrayBuffer());
    if (pdf.byteLength < 5 || new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-")
      throw new OfficePreviewError("The document service returned something other than a PDF");
    return pdf;
  }
}

/** Configured by OFFICE_PREVIEW_URL (the document service's base URL); off when unset. */
export function officePreviewFromEnv(env: NodeJS.ProcessEnv): OfficePreviewConverter | undefined {
  const raw = env.OFFICE_PREVIEW_URL?.trim();
  if (!raw) return undefined;
  if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol))
    throw new Error("OFFICE_PREVIEW_URL must be an http(s) URL");
  return new OfficePreviewConverter(raw);
}
