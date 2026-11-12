import { i18n } from "@lingui/core";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { artifactPreviewKind } from "@rakazo/contracts";
import { artifactTypeLabel, fileSizeParts } from "@rakazo/core";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Spinner } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Download,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Play,
  Presentation,
  X,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import {
  downloadArtifact,
  downloadArtifactBytes,
  fetchArtifactBytes,
  fetchArtifactPreviewPdf,
} from "../lib/artifact-open";
import { getOfficePreviews } from "../lib/bootstrap";
import { useObjectUrl } from "../lib/use-object-url";
import { errorText } from "../lib/user-error";
import { BuiCard } from "./ai/primitives";
import { IconTooltip } from "./IconTooltip";
import { PdfViewer } from "./PdfViewer";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

type ArtifactFileCardProps = {
  target: ArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
};

function isTextPreview(mimeType: string) {
  const kind = artifactPreviewKind(mimeType);
  return kind === "markdown" || kind === "html" || kind === "text";
}

function isArchive(mimeType: string) {
  return /zip|rar|7z|tar|gzip/.test(mimeType);
}

/** The file's own extension ("PPTX"), else a short label for its type; none for generic binaries. */
function typeLabel(name: string, mimeType: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  if (/^[a-z0-9]{1,5}$/i.test(extension)) return extension.toUpperCase();
  return mimeType === "application/octet-stream" ? "" : artifactTypeLabel(mimeType);
}

function fileIcon(mimeType: string): LucideIcon {
  switch (artifactPreviewKind(mimeType)) {
    case "html":
      return Code2;
    case "video":
      return Film;
    case "office":
      if (/presentation|powerpoint/.test(mimeType)) return Presentation;
      if (/sheet|excel/.test(mimeType)) return FileSpreadsheet;
      return FileText;
    case "markdown":
    case "text":
    case "pdf":
      return FileText;
    default:
      return isArchive(mimeType) ? FileArchive : File;
  }
}

export function ArtifactFileCard(props: ArtifactFileCardProps) {
  const { t } = useLingui();
  const kind = artifactPreviewKind(props.mimeType);
  const previewButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const previewable =
    isTextPreview(props.mimeType) || kind === "pdf" || (kind === "office" && getOfficePreviews());

  async function startDownload() {
    setDownloadError(null);
    try {
      await downloadArtifact(props.target, props.artifactId, props.name, props.mimeType);
    } catch {
      setDownloadError(t`Could not download ${props.name}. Try again.`);
    }
  }

  if (kind === "audio") {
    return (
      <BuiCard className="min-w-[280px] p-4 text-foreground">
        <AudioArtifactPreview
          key={JSON.stringify([props.target, props.artifactId, props.mimeType])}
          {...props}
          onDownload={startDownload}
        />
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </BuiCard>
    );
  }

  if (kind === "image") {
    return (
      <ImageArtifactCard
        key={JSON.stringify([props.target, props.artifactId])}
        {...props}
        onDownload={startDownload}
        downloadError={downloadError}
      />
    );
  }

  if (kind === "video") {
    return (
      <VideoArtifactCard
        key={JSON.stringify([props.target, props.artifactId])}
        {...props}
        onDownload={startDownload}
        downloadError={downloadError}
      />
    );
  }

  return (
    <>
      <div>
        <FileRow
          {...props}
          openRef={previewButton}
          onOpen={previewable ? () => setPreviewOpen(true) : undefined}
          openLabel={t`Preview ${props.name}`}
          onDownload={startDownload}
        />
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
      {previewable ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent
            showCloseButton={false}
            initialFocus={closeButton}
            finalFocus={previewButton}
            className="flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          >
            <FilePreview {...props} closeButtonRef={closeButton} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** One file as a card: icon, name, type and size, an optional open action, and download. */
function FileRow({
  name,
  mimeType,
  size,
  openRef,
  onOpen,
  openLabel,
  icon,
  onDownload,
}: {
  name: string;
  mimeType: string;
  size: number;
  openRef?: RefObject<HTMLButtonElement | null>;
  onOpen?: () => void;
  openLabel?: string;
  icon?: ReactNode;
  onDownload: () => Promise<void>;
}) {
  const { t } = useLingui();
  const Icon = fileIcon(mimeType);
  const label = typeLabel(name, mimeType);
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted text-foreground">
        {icon ?? <Icon size={21} strokeWidth={1.8} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body font-medium">{name}</span>
        <span className="mt-0.5 flex gap-2 text-body-sm text-muted-foreground">
          {label ? <span>{label}</span> : null}
          <span data-slot="file-size">{formatSize(size)}</span>
        </span>
      </span>
    </>
  );
  return (
    <BuiCard className="flex min-w-[280px] overflow-hidden text-left text-foreground">
      {onOpen ? (
        <button
          ref={openRef}
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-accent"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">{body}</div>
      )}
      <IconTooltip label={t`Download ${name}`}>
        <button
          type="button"
          aria-label={t`Download ${name}`}
          onClick={() => void onDownload()}
          className="grid w-14 shrink-0 place-items-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Download size={19} strokeWidth={1.8} />
        </button>
      </IconTooltip>
    </BuiCard>
  );
}

function PreviewHeader({
  name,
  onDownload,
  closeButtonRef,
}: {
  name: string;
  onDownload: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useLingui();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-5">
      <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
        {name}
      </DialogTitle>
      <IconTooltip label={t`Download ${name}`}>
        <Button
          variant="ghost"
          size="icon-lg"
          className="rounded-full text-muted-foreground"
          aria-label={t`Download ${name}`}
          onClick={onDownload}
        >
          <Download />
        </Button>
      </IconTooltip>
      <DialogClose
        ref={closeButtonRef}
        aria-label={t`Close preview`}
        render={
          <Button variant="ghost" size="icon-lg" className="rounded-full text-muted-foreground" />
        }
      >
        <X />
      </DialogClose>
    </header>
  );
}

function FilePreview({
  target,
  artifactId,
  name,
  mimeType,
  closeButtonRef,
}: ArtifactFileCardProps & { closeButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { t } = useLingui();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; bytes: Uint8Array; text?: string }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const targetBotId = "botId" in target ? target.botId : undefined;
  const targetGroupId = "groupId" in target ? target.groupId : undefined;
  const kind = artifactPreviewKind(mimeType);

  useEffect(() => {
    if (kind === "office") return;
    let cancelled = false;
    const artifactTarget: ArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    void fetchArtifactBytes(artifactTarget, artifactId)
      .then((bytes) => {
        if (cancelled) return;
        if (!isTextPreview(mimeType)) {
          setState({ status: "ready", bytes });
          return;
        }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          setState({ status: "ready", bytes, text });
        } catch {
          setState({ status: "error", message: t`This file is not valid UTF-8 text.` });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: errorText(error, t`Could not load this file.`),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, targetBotId, targetGroupId, mimeType, kind, t]);

  return (
    <>
      <PreviewHeader
        name={name}
        closeButtonRef={closeButtonRef}
        onDownload={() =>
          void (async () => {
            setDownloadError(null);
            try {
              if (state.status === "ready") downloadArtifactBytes(name, mimeType, state.bytes);
              else await downloadArtifact(target, artifactId, name, mimeType);
            } catch {
              setDownloadError(t`Could not download ${name}. Try again.`);
            }
          })()
        }
      />
      {downloadError ? (
        <div className="shrink-0 px-5 pt-4">
          <DownloadError message={downloadError} />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {kind === "office" ? (
          <OfficePdfPreview target={target} artifactId={artifactId} name={name} />
        ) : state.status === "loading" ? (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Spinner aria-label={t`Loading preview…`} />
          </div>
        ) : state.status === "error" ? (
          <div className="m-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
            {state.message}
          </div>
        ) : kind === "html" && state.text !== undefined ? (
          <SandboxedHtmlViewer html={state.text} title={name} />
        ) : kind === "pdf" ? (
          <PdfViewer bytes={state.bytes} title={name} />
        ) : state.text !== undefined && kind === "text" ? (
          <pre className="px-8 py-10 font-mono text-body-sm leading-6 whitespace-pre-wrap break-words text-foreground sm:px-12 sm:py-12">
            {state.text}
          </pre>
        ) : state.text !== undefined ? (
          <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-body-lg leading-7 text-foreground sm:px-12 sm:py-12">
            <ChatMarkdown>{state.text}</ChatMarkdown>
          </article>
        ) : null}
      </div>
    </>
  );
}

/** A document, sheet or slide deck shown as the PDF the server renders from it. */
export function OfficePdfPreview({
  target,
  artifactId,
  name,
}: {
  target: ArtifactTarget;
  artifactId: string;
  name: string;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; bytes: Uint8Array } | { status: "error" }
  >({ status: "loading" });
  const targetBotId = "botId" in target ? target.botId : undefined;
  const targetGroupId = "groupId" in target ? target.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    const artifactTarget: ArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    void fetchArtifactPreviewPdf(artifactTarget, artifactId)
      .then((bytes) => {
        if (!cancelled) setState({ status: "ready", bytes });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, targetBotId, targetGroupId]);

  if (state.status === "ready") return <PdfViewer bytes={state.bytes} title={name} />;
  return (
    <div className="grid h-full min-h-40 place-items-center px-6 text-center text-body text-muted-foreground">
      {state.status === "loading" ? (
        <Spinner aria-label={t`Loading preview…`} />
      ) : (
        <span role="alert">{t`Can't preview this file. Download it instead.`}</span>
      )}
    </div>
  );
}

/** An image fitted to its box on a muted ground, so transparent PNG, GIF and SVG read well. */
export function ImageStage({
  bytes,
  mimeType,
  name,
  className,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
  className?: string;
}) {
  // SVG is only ever shown through <img>, so its scripts never run.
  const url = useObjectUrl(bytes, mimeType);
  return (
    <div className={`grid place-items-center overflow-auto bg-muted ${className ?? ""}`}>
      {url ? <img src={url} alt={name} className="max-h-full max-w-full object-contain" /> : null}
    </div>
  );
}

function ImageArtifactCard({
  target,
  artifactId,
  name,
  mimeType,
  size,
  onDownload,
  downloadError,
}: ArtifactFileCardProps & { onDownload: () => Promise<void>; downloadError: string | null }) {
  const { t } = useLingui();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; bytes: Uint8Array } | { status: "error" }
  >({ status: "loading" });
  const [open, setOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const targetBotId = "botId" in target ? target.botId : undefined;
  const targetGroupId = "groupId" in target ? target.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    const artifactTarget: ArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    void fetchArtifactBytes(artifactTarget, artifactId)
      .then((bytes) => {
        if (!cancelled) setState({ status: "ready", bytes });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [targetBotId, targetGroupId, artifactId]);

  if (state.status === "error") {
    return (
      <div>
        <FileRow
          name={name}
          mimeType={mimeType}
          size={size}
          icon={<File size={21} strokeWidth={1.8} />}
          onDownload={onDownload}
        />
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
    );
  }

  return (
    <>
      <div>
        <BuiCard className="w-fit max-w-full overflow-hidden text-left text-foreground">
          {state.status === "ready" ? (
            <button
              ref={openButton}
              type="button"
              aria-label={t`View ${name}`}
              onClick={() => setOpen(true)}
              className="block bg-muted"
            >
              <ImageThumb bytes={state.bytes} mimeType={mimeType} name={name} />
            </button>
          ) : (
            <div className="grid h-40 w-64 max-w-full place-items-center bg-muted text-muted-foreground">
              <Spinner aria-label={t`Loading preview…`} />
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-border py-1 ps-3 pe-1">
            <span className="min-w-0 flex-1 truncate text-body-sm font-medium">{name}</span>
            <span data-slot="file-size" className="shrink-0 text-body-sm text-muted-foreground">
              {formatSize(size)}
            </span>
            <IconTooltip label={t`Download ${name}`}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`Download ${name}`}
                onClick={() => void onDownload()}
                className="text-muted-foreground"
              >
                <Download strokeWidth={1.8} />
              </Button>
            </IconTooltip>
          </div>
        </BuiCard>
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
      {state.status === "ready" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            showCloseButton={false}
            initialFocus={closeButton}
            finalFocus={openButton}
            className="flex h-[min(92vh,1000px)] w-[min(1200px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          >
            <PreviewHeader
              name={name}
              closeButtonRef={closeButton}
              onDownload={() => void onDownload()}
            />
            <ImageStage
              bytes={state.bytes}
              mimeType={mimeType}
              name={name}
              className="min-h-0 flex-1 p-4"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function ImageThumb({
  bytes,
  mimeType,
  name,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}) {
  const url = useObjectUrl(bytes, mimeType) ?? undefined;
  return (
    <img
      src={url}
      alt={name}
      className="block max-h-[320px] max-w-full object-contain sm:max-w-[360px]"
    />
  );
}

function VideoArtifactCard({
  target,
  artifactId,
  name,
  mimeType,
  size,
  onDownload,
  downloadError,
}: ArtifactFileCardProps & { onDownload: () => Promise<void>; downloadError: string | null }) {
  const { t } = useLingui();
  const [state, setState] = useState<
    | { status: "idle" | "loading" | "failed" }
    | { status: "ready"; bytes: Uint8Array }
    | { status: "error" }
  >({ status: "idle" });
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function play() {
    if (state.status !== "idle") return;
    setState({ status: "loading" });
    try {
      const bytes = await fetchArtifactBytes(target, artifactId);
      if (!cancelled.current) setState({ status: "ready", bytes });
    } catch {
      if (!cancelled.current) setState({ status: "error" });
    }
  }

  const playing = state.status === "ready";
  return (
    <div>
      <div className="w-fit min-w-[280px] max-w-full">
        {playing ? (
          <BuiCard className="mb-2 overflow-hidden bg-muted">
            <VideoPreview
              bytes={state.bytes}
              mimeType={mimeType}
              name={name}
              autoPlay
              onError={() => setState({ status: "failed" })}
              className="max-h-[360px] w-full object-contain"
            />
          </BuiCard>
        ) : null}
        <FileRow
          name={name}
          mimeType={mimeType}
          size={size}
          onOpen={playing ? undefined : () => void play()}
          openLabel={t`Play ${name}`}
          icon={
            state.status === "loading" ? (
              <Spinner aria-label={t`Loading preview…`} />
            ) : (
              <Play size={21} strokeWidth={1.8} />
            )
          }
          onDownload={onDownload}
        />
      </div>
      {state.status === "error" ? <DownloadError message={t`Could not load this file.`} /> : null}
      {state.status === "failed" ? (
        <DownloadError message={t`Your browser can't play this video. Download it instead.`} />
      ) : null}
      {downloadError ? <DownloadError message={downloadError} /> : null}
    </div>
  );
}

function AudioArtifactPreview({
  target,
  artifactId,
  name,
  mimeType,
  onDownload,
}: ArtifactFileCardProps & { onDownload: () => Promise<void> }) {
  const { t } = useLingui();
  const [state, setState] = useState<
    { status: "idle" | "loading" } | { status: "ready"; src: string } | { status: "error" }
  >({ status: "idle" });
  const lifetime = useRef<{ cancelled: boolean; started: boolean; url?: string }>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const current = { cancelled: false, started: false, url: undefined as string | undefined };
    lifetime.current = current;
    return () => {
      current.cancelled = true;
      if (current.url) URL.revokeObjectURL(current.url);
    };
  }, []);
  useEffect(() => {
    if (state.status !== "ready") return;
    const player = audio.current;
    void player?.play().catch(() => {});
    return () => player?.pause();
  }, [state]);

  async function startPlayback() {
    const current = lifetime.current;
    if (!current || current.cancelled || current.started) return;
    current.started = true;
    setState({ status: "loading" });
    try {
      const bytes = await fetchArtifactBytes(target, artifactId);
      if (current.cancelled) return;
      if (artifactPreviewKind(mimeType) !== "audio") throw new Error("Unsupported audio type");
      current.url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
      setState({ status: "ready", src: current.url });
    } catch {
      if (!current.cancelled) setState({ status: "error" });
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {state.status === "idle" || state.status === "loading" ? (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t`Play ${name}`}
            aria-busy={state.status === "loading"}
            disabled={state.status === "loading"}
            onClick={() => void startPlayback()}
          >
            <Play />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-body font-medium">{name}</span>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t`Download ${name}`}
          onClick={() => void onDownload()}
          className="text-muted-foreground"
        >
          <Download strokeWidth={1.8} className="size-[19px]" />
        </Button>
      </div>
      {state.status === "loading" ? (
        <span className="text-body text-muted-foreground">
          <Spinner aria-label={t`Loading preview…`} />
        </span>
      ) : state.status === "error" ? (
        <DownloadError message={t`Could not load this file.`} />
      ) : state.status === "ready" ? (
        // biome-ignore lint/a11y/useMediaCaption: Attachment playback has no caption track supplied by the author.
        <audio
          ref={audio}
          src={state.src}
          controls
          preload="metadata"
          aria-label={name}
          className="mt-3 w-full"
        />
      ) : null}
    </>
  );
}

export function VideoPreview({
  bytes,
  name,
  mimeType = "video/mp4",
  autoPlay,
  onError,
  className = "h-full w-full object-contain",
}: {
  bytes: Uint8Array;
  name: string;
  mimeType?: string;
  autoPlay?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const src = useObjectUrl(bytes, mimeType) ?? undefined;
  return (
    // biome-ignore lint/a11y/useMediaCaption: Attachment playback has no caption track supplied by the author.
    <video
      src={src}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      aria-label={name}
      onError={onError}
      className={className}
    />
  );
}

function DownloadError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-2 text-left text-body-sm text-destructive">
      {message}
    </div>
  );
}

function formatSize(bytes: number): string {
  const parts = fileSizeParts(bytes, i18n.locale || "en");
  if (!parts) return "";
  const size = parts.amount;
  switch (parts.unit) {
    case "B":
      return translate`${size} B`;
    case "KB":
      return translate`${parts.amount} KB`;
    case "MB":
      return translate`${parts.amount} MB`;
    case "GB":
      return translate`${parts.amount} GB`;
    case "TB":
      return translate`${parts.amount} TB`;
  }
}
