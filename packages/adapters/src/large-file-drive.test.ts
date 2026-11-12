import { describe, expect, it, vi } from "vitest";
import {
  LargeFileDrive,
  LargeFileError,
  largeFileDriveFromEnv,
  largeFileName,
} from "./large-file-drive.js";

const config = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  folderId: "folder-1",
  origin: "https://app.example.test",
};
const token = () => new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }));

describe("LargeFileDrive", () => {
  it("opens a session in the shared folder for the app's origin", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/s1" },
        }),
      );
    const drive = new LargeFileDrive({ ...config, fetch });
    await expect(
      drive.startUpload({ name: "../clips/a.mov", size: 10, mimeType: "video/quicktime" }),
    ).resolves.toBe("https://upload.example.test/s1");
    const [, init] = fetch.mock.calls[1]!;
    expect(init.headers.origin).toBe("https://app.example.test");
    expect(init.headers["x-upload-content-length"]).toBe("10");
    expect(JSON.parse(init.body)).toEqual({ name: "a.mov", parents: ["folder-1"] });
  });

  it("reuses the access token", async () => {
    const session = () =>
      new Response(null, { status: 200, headers: { location: "https://upload.example.test/s" } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(session());
    const drive = new LargeFileDrive({ ...config, fetch });
    await drive.startUpload({ name: "a", size: 1 });
    await drive.startUpload({ name: "b", size: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses bad sizes before calling out", async () => {
    const fetch = vi.fn();
    const drive = new LargeFileDrive({ ...config, fetch });
    await expect(drive.startUpload({ name: "a", size: 0 })).rejects.toBeInstanceOf(LargeFileError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("only reports files that are in the shared folder", async () => {
    const file = (parents: string[]) =>
      new Response(
        JSON.stringify({
          id: "f1",
          name: "a.mov",
          size: "42",
          parents,
          webViewLink: "https://drive.example.test/f1",
        }),
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(file(["folder-1"]))
      .mockResolvedValueOnce(file(["other"]));
    const drive = new LargeFileDrive({ ...config, fetch });
    await expect(drive.finished("f1abcdefghij")).resolves.toEqual({
      id: "f1",
      name: "a.mov",
      size: 42,
      link: "https://drive.example.test/f1",
    });
    await expect(drive.finished("f1abcdefghij")).rejects.toBeInstanceOf(LargeFileError);
    await expect(drive.finished("../etc")).rejects.toBeInstanceOf(LargeFileError);
  });

  it("is off unless every setting is present", () => {
    expect(
      largeFileDriveFromEnv({ LARGE_FILE_DRIVE_CLIENT_ID: "a" }, "https://x.test"),
    ).toBeUndefined();
    expect(
      largeFileDriveFromEnv(
        {
          LARGE_FILE_DRIVE_CLIENT_ID: "a",
          LARGE_FILE_DRIVE_CLIENT_SECRET: "b",
          LARGE_FILE_DRIVE_REFRESH_TOKEN: "c",
          LARGE_FILE_DRIVE_FOLDER_ID: "d",
        },
        "https://x.test",
      ),
    ).toBeInstanceOf(LargeFileDrive);
  });

  it("cleans file names", () => {
    expect(largeFileName("C:\\Users\\me\\clip.mp4")).toBe("clip.mp4");
    expect(largeFileName("a\u0000b")).toBe("ab");
    expect(largeFileName("/")).toBe("file");
  });
});
