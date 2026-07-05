"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AudioFormat,
  DownloadKind,
  DownloadRequest,
  DownloadStartResponse,
  ProgressEvent,
  VideoInfo,
} from "@/lib/types";

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; info: VideoInfo };

type DownloadState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "active"; progress: ProgressEvent }
  | { status: "complete" }
  | { status: "error"; message: string };

const BITRATES = [320, 256, 192, 128, 96, 64] as const;
const AUDIO_FORMATS: AudioFormat[] = ["mp3", "m4a"];

/** Read an `{ error }` body defensively; never throws. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export default function Downloader() {
  const [url, setUrl] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });

  const [kind, setKind] = useState<DownloadKind>("video");
  const [height, setHeight] = useState<number | null>(null);
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");
  const [audioBitrate, setAudioBitrate] = useState<number>(192);

  const [download, setDownload] = useState<DownloadState>({ status: "idle" });
  const eventSourceRef = useRef<EventSource | null>(null);

  // Tidy up any open SSE connection on unmount.
  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  const info = fetchState.status === "loaded" ? fetchState.info : null;

  const handleFetch = useCallback(async () => {
    eventSourceRef.current?.close();
    setDownload({ status: "idle" });
    setFetchState({ status: "loading" });
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        setFetchState({
          status: "error",
          message: await readError(res, "Failed to fetch video info."),
        });
        return;
      }
      const data = (await res.json()) as VideoInfo;
      setFetchState({ status: "loaded", info: data });
      // Default to the highest resolution offered.
      setHeight(data.resolutions[0]?.height ?? null);
    } catch {
      setFetchState({
        status: "error",
        message: "Network error while fetching video info.",
      });
    }
  }, [url]);

  const handleDownload = useCallback(async () => {
    if (!info) return;
    eventSourceRef.current?.close();
    setDownload({ status: "starting" });

    const body: DownloadRequest = {
      url: info.webpageUrl,
      kind,
      ...(kind === "video" ? { height: height ?? undefined } : {}),
      ...(kind === "audio" ? { audioFormat, audioBitrate } : {}),
    };

    let jobId: string;
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setDownload({
          status: "error",
          message: await readError(res, "Failed to start download."),
        });
        return;
      }
      jobId = ((await res.json()) as DownloadStartResponse).jobId;
    } catch {
      setDownload({ status: "error", message: "Network error starting download." });
      return;
    }

    // Subscribe to progress via SSE.
    const es = new EventSource(`/api/progress?jobId=${encodeURIComponent(jobId)}`);
    eventSourceRef.current = es;

    es.onmessage = (evt) => {
      const progress = JSON.parse(evt.data) as ProgressEvent;
      if (progress.status === "error") {
        es.close();
        setDownload({ status: "error", message: progress.error ?? "Download failed." });
        return;
      }
      if (progress.status === "canceled") {
        es.close();
        setDownload({ status: "error", message: "Download was canceled." });
        return;
      }
      if (progress.status === "complete") {
        es.close();
        setDownload({ status: "complete" });
        // Trigger the browser download of the finished file.
        window.location.href = `/api/file?jobId=${encodeURIComponent(jobId)}`;
        return;
      }
      setDownload({ status: "active", progress });
    };

    es.onerror = () => {
      // EventSource auto-reconnects; only surface an error if we never finished.
      setDownload((prev) =>
        prev.status === "complete"
          ? prev
          : { status: "error", message: "Lost connection to the download stream." }
      );
      es.close();
    };
  }, [info, kind, height, audioFormat, audioBitrate]);

  const isBusy = download.status === "starting" || download.status === "active";

  return (
    <div className="space-y-6">
      {/* URL input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim() && fetchState.status !== "loading") handleFetch();
        }}
        className="flex flex-col gap-2.5 sm:flex-row"
      >
        <div className="relative flex-1">
          <LinkIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" />
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="Paste a YouTube link…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 dark:border-neutral-700 dark:bg-neutral-900 dark:placeholder:text-neutral-600 dark:focus:border-red-500"
          />
        </div>
        <button
          type="submit"
          disabled={!url.trim() || fetchState.status === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fetchState.status === "loading" ? (
            <>
              <Spinner className="h-4 w-4" />
              Fetching…
            </>
          ) : (
            "Fetch info"
          )}
        </button>
      </form>

      {/* Fetch error */}
      {fetchState.status === "error" && <Banner tone="error">{fetchState.message}</Banner>}

      {/* Loading skeleton */}
      {fetchState.status === "loading" && (
        <div className="animate-pulse rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex gap-4">
            <div className="aspect-video w-44 shrink-0 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
            <div className="flex-1 space-y-2.5 py-1">
              <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/4 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
          </div>
        </div>
      )}

      {/* Info card + controls */}
      {info && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
          {/* Header: thumbnail + meta */}
          <div className="flex flex-col gap-4 p-4 sm:flex-row">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800 sm:w-44">
              {info.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={info.thumbnail} alt="" className="h-full w-full object-cover" />
              )}
              {info.durationString && (
                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                  {info.durationString}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h2 className="line-clamp-2 font-semibold leading-snug">{info.title}</h2>
              <p className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                <UserIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{info.uploader}</span>
              </p>
              {info.resolutions[0] && (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Up to {info.resolutions[0].label}
                </p>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-4 border-t border-neutral-100 p-4 dark:border-neutral-800">
            {/* Kind toggle */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/70">
              {([
                { k: "video" as const, label: "Video", Icon: VideoIcon },
                { k: "audio" as const, label: "Audio", Icon: AudioIcon },
              ]).map(({ k, label, Icon }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={isBusy}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                    kind === k
                      ? "bg-white text-red-600 shadow-sm dark:bg-neutral-950 dark:text-red-400"
                      : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Options */}
            {kind === "video" ? (
              <Field label="Resolution" hint="Output: MP4 (video + audio merged)">
                {info.resolutions.length > 0 ? (
                  <Select
                    value={height ?? ""}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    disabled={isBusy}
                  >
                    {info.resolutions.map((r) => (
                      <option key={r.height} value={r.height}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm text-neutral-500">
                    No separate resolutions reported; best available will be used.
                  </p>
                )}
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Format">
                  <Select
                    value={audioFormat}
                    onChange={(e) => setAudioFormat(e.target.value as AudioFormat)}
                    disabled={isBusy}
                  >
                    {AUDIO_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bitrate">
                  <Select
                    value={audioBitrate}
                    onChange={(e) => setAudioBitrate(Number(e.target.value))}
                    disabled={isBusy}
                  >
                    {BITRATES.map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            {/* Download button */}
            <button
              type="button"
              onClick={handleDownload}
              disabled={isBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? (
                <>
                  <Spinner className="h-4 w-4" />
                  {download.status === "starting" ? "Preparing…" : "Downloading…"}
                </>
              ) : (
                <>
                  <DownloadIcon className="h-4 w-4" />
                  {kind === "video" ? "Download video" : "Download audio"}
                </>
              )}
            </button>

            {/* Progress */}
            {(download.status === "active" || download.status === "starting") && (
              <ProgressBar state={download} />
            )}

            {download.status === "complete" && (
              <Banner tone="success">
                Done — your file should be downloading. If not, check your browser downloads.
              </Banner>
            )}

            {download.status === "error" && <Banner tone="error">{download.message}</Banner>}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Presentational helpers                                                      */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-neutral-400 dark:text-neutral-500">{hint}</span>}
    </label>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className="w-full appearance-none rounded-xl border border-neutral-300 bg-white px-3 py-2.5 pr-9 text-sm outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-500/10 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950/40"
      />
      <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const styles =
    tone === "error"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
      : "border-green-300 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300";
  return (
    <p className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${styles}`}>
      {tone === "error" ? (
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{children}</span>
    </p>
  );
}

const PHASE_LABELS: Record<ProgressEvent["phase"], string> = {
  starting: "Starting…",
  downloading: "Downloading",
  merging: "Merging video + audio…",
  converting: "Converting audio…",
  done: "Done",
};

function ProgressBar({
  state,
}: {
  state: Extract<DownloadState, { status: "active" | "starting" }>;
}) {
  const progress = state.status === "active" ? state.progress : null;
  const percent = progress?.percent ?? 0;
  const phase = progress?.phase ?? "starting";
  const indeterminate =
    phase === "merging" || phase === "converting" || progress?.percent == null;

  return (
    <div className="space-y-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/40">
      <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span className="font-medium text-neutral-700 dark:text-neutral-200">
          {PHASE_LABELS[phase]}
        </span>
        <span className="tabular-nums">
          {!indeterminate ? `${percent.toFixed(1)}%` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full bg-gradient-to-r from-red-500 to-red-600 transition-[width] duration-300 ease-out ${
            indeterminate ? "animate-pulse" : ""
          }`}
          style={{ width: indeterminate ? "100%" : `${Math.max(2, percent)}%` }}
        />
      </div>
      {(progress?.speed || progress?.eta) && (
        <div className="flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
          {progress?.speed && <span className="tabular-nums">{progress.speed}</span>}
          {progress?.eta && <span className="tabular-nums">ETA {progress.eta}</span>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons (inline, no dependency)                                               */
/* -------------------------------------------------------------------------- */

type IconProps = { className?: string };

function LinkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function VideoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m22 8-6 4 6 4V8Z" />
    </svg>
  );
}

function AudioIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function UserIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function AlertIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Spinner({ className }: IconProps) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  );
}
