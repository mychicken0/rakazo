import { describe, expect, it, vi } from "vitest";
import { formatFileSize, LARGE_UPLOAD_CHUNK_BYTES, uploadLargeFile } from "./large-upload";

const URL_ = "https://upload.example.test/session";

function rpcFor() {
  return {
    largeFiles: {
      start: vi.fn(async () => ({ uploadUrl: URL_ })),
      finish: vi.fn(async ({ fileId }: { fileId: string }) => ({
        name: "clip.mov",
        size: 3,
        link: `https://drive.example.test/${fileId}`,
      })),
    },
  };
}

type Rpc = Parameters<typeof uploadLargeFile>[0];

const resume = (end: number) =>
  new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
const done = (id: string) => new Response(JSON.stringify({ id }), { status: 200 });

describe("uploadLargeFile", () => {
  it("sends the file in chunks and finishes with the stored file", async () => {
    const size = LARGE_UPLOAD_CHUNK_BYTES + 10;
    const file = new File([new Uint8Array(size)], "clip.mov", { type: "video/quicktime" });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(resume(LARGE_UPLOAD_CHUNK_BYTES - 1))
      .mockResolvedValueOnce(done("file-9"));
    const progress: number[] = [];
    const rpc = rpcFor();
    const result = await uploadLargeFile(
      rpc as never as Rpc,
      file,
      (p) => progress.push(p),
      new AbortController().signal,
      fetch,
    );
    expect(rpc.largeFiles.start).toHaveBeenCalledWith({
      name: "clip.mov",
      size,
      mimeType: "video/quicktime",
    });
    expect(fetch.mock.calls[0]![1].headers["content-range"]).toBe(
      `bytes 0-${LARGE_UPLOAD_CHUNK_BYTES - 1}/${size}`,
    );
    expect(fetch.mock.calls[1]![1].headers["content-range"]).toBe(
      `bytes ${LARGE_UPLOAD_CHUNK_BYTES}-${size - 1}/${size}`,
    );
    expect(rpc.largeFiles.finish).toHaveBeenCalledWith({ fileId: "file-9" });
    expect(result.link).toBe("https://drive.example.test/file-9");
    expect(progress.at(-1)).toBe(1);
  });

  it("asks what arrived after a dropped connection and continues from there", async () => {
    vi.useFakeTimers();
    const size = LARGE_UPLOAD_CHUNK_BYTES * 2;
    const file = new File([new Uint8Array(size)], "clip.mov");
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(resume(LARGE_UPLOAD_CHUNK_BYTES - 1))
      .mockResolvedValueOnce(done("file-2"));
    const pending = uploadLargeFile(
      rpcFor() as never as Rpc,
      file,
      () => {},
      new AbortController().signal,
      fetch,
    );
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ name: "clip.mov" });
    vi.useRealTimers();
    expect(fetch.mock.calls[1]![1].headers["content-range"]).toBe(`bytes */${size}`);
    expect(fetch.mock.calls[2]![1].headers["content-range"]).toBe(
      `bytes ${LARGE_UPLOAD_CHUNK_BYTES}-${size - 1}/${size}`,
    );
  });

  it("stops on a refusal instead of retrying", async () => {
    const file = new File([new Uint8Array(5)], "a.bin");
    const fetch = vi.fn().mockResolvedValue(new Response("no", { status: 403 }));
    await expect(
      uploadLargeFile(
        rpcFor() as never as Rpc,
        file,
        () => {},
        new AbortController().signal,
        fetch,
      ),
    ).rejects.toThrow("Upload refused (403)");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("formats sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});
