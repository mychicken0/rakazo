import { describe, expect, it, vi } from "vitest";
import {
  OfficePreviewConverter,
  OfficePreviewError,
  officePreviewFromEnv,
} from "./office-preview.js";

const pdf = () => new Response(new TextEncoder().encode("%PDF-1.7 fake"), { status: 200 });

describe("OfficePreviewConverter", () => {
  it("posts the file under its own name and returns the PDF", async () => {
    const fetch = vi.fn(async () => pdf());
    const converter = new OfficePreviewConverter("http://docs.internal:3000", { fetch });
    const out = await converter.toPdf("a:1", "deck.pptx", new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(out).startsWith("%PDF-")).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://docs.internal:3000/forms/libreoffice/convert");
    const file = (init.body as FormData).get("files") as File;
    expect(file.name).toBe("deck.pptx");
  });

  it("converts each version once and shares a conversion already running", async () => {
    const fetch = vi.fn(async () => pdf());
    const converter = new OfficePreviewConverter("http://docs.internal:3000", { fetch });
    await Promise.all([
      converter.toPdf("a:1", "d.docx", new Uint8Array(1)),
      converter.toPdf("a:1", "d.docx", new Uint8Array(1)),
    ]);
    await converter.toPdf("a:1", "d.docx", new Uint8Array(1));
    expect(fetch).toHaveBeenCalledOnce();
    await converter.toPdf("a:2", "d.docx", new Uint8Array(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed or non-PDF conversion without caching it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("<html>", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("refused"));
    const converter = new OfficePreviewConverter("http://docs.internal:3000", { fetch });
    for (let i = 0; i < 3; i++)
      await expect(converter.toPdf("a:1", "d.docx", new Uint8Array(1))).rejects.toBeInstanceOf(
        OfficePreviewError,
      );
  });

  it("is off unless configured, and refuses odd URLs", () => {
    expect(officePreviewFromEnv({})).toBeUndefined();
    expect(
      officePreviewFromEnv({ OFFICE_PREVIEW_URL: "http://office-preview:3000" }),
    ).toBeInstanceOf(OfficePreviewConverter);
    expect(() => officePreviewFromEnv({ OFFICE_PREVIEW_URL: "file:///etc" })).toThrow();
  });
});
