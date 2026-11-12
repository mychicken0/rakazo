// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  pdf: vi.fn(),
  office: vi.fn(),
}));
vi.mock("../lib/artifact-open", () => ({
  fetchArtifactBytes: mocks.fetch,
  downloadArtifact: mocks.download,
  downloadArtifactBytes: vi.fn(),
  fetchArtifactPreviewPdf: mocks.pdf,
}));
vi.mock("../lib/bootstrap", () => ({ getOfficePreviews: mocks.office }));
vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    `«${strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "")}»`,
}));
vi.mock("./PdfViewer", () => ({ PdfViewer: () => <div data-testid="pdf-viewer" /> }));
vi.mock("@rakazo/chat-ui/web", () => ({ ChatMarkdown: () => null }));

import { ArtifactFileCard } from "./ArtifactFileCard";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = mocks.create;
      static override revokeObjectURL = mocks.revoke;
    },
  );
  mocks.create.mockReset().mockReturnValue("blob:audio-preview");
  mocks.revoke.mockReset();
  mocks.pdf.mockReset().mockResolvedValue(new Uint8Array([37, 80]));
  mocks.office.mockReset().mockReturnValue(true);
  mocks.fetch.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.download.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"])(
  "renders %s controls, keeps download, and revokes playback URL",
  async (mimeType) => {
    await act(async () =>
      root?.render(
        <ArtifactFileCard
          target={{ botId: "bot-1" }}
          artifactId="audio-1"
          name="clip"
          mimeType={mimeType}
          size={3}
        />,
      ),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.querySelector("audio")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Play clip"]')?.click(),
    );
    const audio = container.querySelector("audio");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("preload")).toBe("metadata");
    expect(audio?.getAttribute("aria-label")).toBe("clip");
    expect(audio?.getAttribute("src")).toBe("blob:audio-preview");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[0].type).toBe(mimeType);
    expect(mocks.fetch).toHaveBeenCalledWith({ botId: "bot-1" }, "audio-1");
    const download = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Download clip"]',
    );
    expect(download).not.toBeNull();
    await act(async () => download?.click());
    expect(mocks.download).toHaveBeenCalledWith({ botId: "bot-1" }, "audio-1", "clip", mimeType);
    await act(async () => root?.unmount());
    root = undefined;
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:audio-preview");
  },
);
it("retains the download control when playback bytes fail to load", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () =>
    root?.render(
      <ArtifactFileCard
        target={{ groupId: "group-1" }}
        artifactId="audio-1"
        name="clip"
        mimeType="audio/mpeg"
        size={3}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Play clip"]')?.click(),
  );
  expect(container.querySelector("audio")).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Download clip"]')).not.toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Download clip"]')?.click(),
  );
  expect(mocks.download).toHaveBeenCalledWith(
    { groupId: "group-1" },
    "audio-1",
    "clip",
    "audio/mpeg",
  );
});

function renderClip(artifactId = "audio-1") {
  root?.render(
    <ArtifactFileCard
      target={{ groupId: "group-1" }}
      artifactId={artifactId}
      name="clip"
      mimeType="audio/mpeg"
      size={3}
    />,
  );
}

it("downloads independently before playback", async () => {
  await act(async () => renderClip());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Download clip"]')?.click(),
  );
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(container.querySelector("audio")).toBeNull();
});

it.each(["unmount", "change"])(
  "ignores pending bytes after %s and suppresses duplicate play",
  async (cleanup) => {
    let resolve!: (bytes: Uint8Array) => void;
    mocks.fetch.mockReturnValueOnce(
      new Promise<Uint8Array>((done) => {
        resolve = done;
      }),
    );
    await act(async () => renderClip());
    const play = container.querySelector<HTMLButtonElement>('button[aria-label="Play clip"]')!;
    await act(async () => {
      play.click();
      play.click();
    });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith({ groupId: "group-1" }, "audio-1");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      if (cleanup === "change") renderClip("audio-2");
      else {
        root?.unmount();
        root = undefined;
      }
    });
    await act(async () => resolve(new Uint8Array([1])));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(container.querySelector("audio")).toBeNull();
  },
);

it("stops playback and revokes the old URL on artifact change", async () => {
  await act(async () => renderClip());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Play clip"]')?.click(),
  );
  await act(async () => renderClip("audio-2"));
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:audio-preview");
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  expect(container.querySelector("audio")).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("keeps controls when automatic playback is rejected", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("blocked"));
  await act(async () => renderClip());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Play clip"]')?.click(),
  );
  expect(container.querySelector("audio")?.hasAttribute("controls")).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("translates every size unit and rolls up instead of 1,024.0 KB or 1,536.0 MB", async () => {
  await act(async () =>
    root?.render(
      <>
        {[512, 1024, 1048575, 1610612736, 1.5 * 1024 ** 4].map((size) => (
          <ArtifactFileCard
            key={size}
            target={{ botId: "b" }}
            artifactId={`a${size}`}
            name={`f${size}.zip`}
            mimeType="application/zip"
            size={size}
          />
        ))}
      </>,
    ),
  );
  const sizes = [...container.querySelectorAll('[data-slot="file-size"]')].map(
    (el) => el.textContent,
  );
  expect(sizes).toEqual(["«512 B»", "«1 KB»", "«1 MB»", "«1.5 GB»", "«1.5 TB»"]);
});

it("previews plain text in the app instead of only offering a download", async () => {
  mocks.fetch.mockResolvedValue(new TextEncoder().encode("1. Confirm the pricing page copy."));
  await act(async () =>
    root?.render(
      <ArtifactFileCard
        target={{ botId: "bot-1" }}
        artifactId="notes-1"
        name="notes.txt"
        mimeType="text/plain"
        size={33}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Preview notes.txt"]')?.click(),
  );
  await vi.waitFor(() =>
    expect(document.body.querySelector("pre")?.textContent).toBe(
      "1. Confirm the pricing page copy.",
    ),
  );
});

function renderCard(name: string, mimeType: string, artifactId = "file-1") {
  return act(async () =>
    root?.render(
      <ArtifactFileCard
        target={{ botId: "bot-1" }}
        artifactId={artifactId}
        name={name}
        mimeType={mimeType}
        size={2048}
      />,
    ),
  );
}

it.each([
  ["logo.svg", "image/svg+xml"],
  ["anim.gif", "image/gif"],
])("shows %s as an image from an object URL, never inline markup", async (name, mimeType) => {
  mocks.create.mockReturnValue("blob:image");
  await renderCard(name, mimeType);
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe("blob:image");
  expect(container.querySelector("iframe, object, embed")).toBeNull();
  expect(mocks.create.mock.calls[0]?.[0].type).toBe(mimeType);
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="View ${name}"]`)?.click(),
  );
  expect(document.body.querySelectorAll("img").length).toBe(2);
  await act(async () => root?.unmount());
  root = undefined;
  expect(mocks.revoke).toHaveBeenCalledWith("blob:image");
});

it("falls back to the file card when an image cannot be loaded", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("gone"));
  await renderCard("pic.png", "image/png");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('button[aria-label="Download pic.png"]')).not.toBeNull();
});

it("loads video bytes only after play", async () => {
  mocks.create.mockReturnValue("blob:video");
  await renderCard("clip.mov", "video/quicktime");
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(container.querySelector("video")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Play clip.mov"]')?.click(),
  );
  const video = container.querySelector("video");
  expect(video?.getAttribute("src")).toBe("blob:video");
  expect(video?.hasAttribute("controls")).toBe(true);
  expect(mocks.create.mock.calls[0]?.[0].type).toBe("video/quicktime");
  await act(async () => {
    video?.dispatchEvent(new Event("error"));
  });
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Download clip.mov"]')).not.toBeNull();
});

it("plays flac as audio", async () => {
  await renderCard("song.flac", "audio/flac");
  expect(container.querySelector('button[aria-label="Play song.flac"]')).not.toBeNull();
});

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

it("renders an office file through its PDF preview", async () => {
  await renderCard("deck.pptx", PPTX);
  expect(container.textContent).toContain("PPTX");
  expect(mocks.pdf).not.toHaveBeenCalled();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Preview deck.pptx"]')?.click(),
  );
  expect(mocks.pdf).toHaveBeenCalledWith({ botId: "bot-1" }, "file-1");
  expect(mocks.fetch).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(document.body.querySelector('[data-testid="pdf-viewer"]')).not.toBeNull(),
  );
});

it("says so when an office file cannot be previewed and keeps download", async () => {
  mocks.pdf.mockRejectedValueOnce(new Error("NOT_FOUND"));
  await renderCard("deck.pptx", PPTX);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Preview deck.pptx"]')?.click(),
  );
  await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')).not.toBeNull());
  expect(document.body.querySelector('button[aria-label="Download deck.pptx"]')).not.toBeNull();
});

it("offers office files as plain cards when the server cannot convert", async () => {
  mocks.office.mockReturnValue(false);
  await renderCard("deck.pptx", PPTX);
  expect(container.querySelector('button[aria-label="Preview deck.pptx"]')).toBeNull();
  expect(container.querySelector('button[aria-label="Download deck.pptx"]')).not.toBeNull();
});

it("shows a short type label instead of the mime type on a generic file", async () => {
  await renderCard("model.psd", "image/vnd.adobe.photoshop");
  expect(container.textContent).toContain("PSD");
  expect(container.textContent).not.toContain("image/vnd");
  await renderCard("bundle.zip", "application/zip");
  expect(container.textContent).toContain("ZIP");
  expect(container.textContent).not.toContain("application/zip");
});
