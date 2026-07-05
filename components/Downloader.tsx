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
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-red-500/40 placeholder:text-neutral-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900 dark:placeholder:text-neutral-600"
        />
        <button
          type="submit"
          disabled={!url.trim() || fetchState.status === "loading"}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fetchState.status === "loading" ? "Fetching…" : "Fetch info"}
        </button>
      </form>

      {/* Fetch error */}
      {fetchState.status === "error" && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {fetchState.message}
        </p>
      )}

      {/* Loading skeleton */}
      {fetchState.status === "loading" && (
        <div className="animate-pulse rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex gap-4">
            <div className="h-20 w-36 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
            </div>
          </div>
        </div>
      )}

      {/* Info card + controls */}
      {info && (
        <section className="space-y-5 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-col gap-4 sm:flex-row">
            {info.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={info.thumbnail}
                alt=""
                className="h-auto w-full rounded-lg object-cover sm:w-40"
              />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="line-clamp-2 font-medium leading-snug">{info.title}</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {info.uploader}
              </p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {info.durationString}
              </p>
            </div>
          </div>

          {/* Kind toggle */}
          <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 dark:border-neutral-700">
            {(["video", "audio"] as DownloadKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                disabled={isBusy}
                className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition disabled:opacity-50 ${
                  kind === k
                    ? "bg-red-600 text-white"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Options */}
          {kind === "video" ? (
            <label className="block space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-300">
                Resolution
              </span>
              {info.resolutions.length > 0 ? (
                <select
                  value={height ?? ""}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {info.resolutions.map((r) => (
                    <option key={r.height} value={r.height}>
                      {r.label}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-neutral-500">
                  No separate video resolutions reported; best available will be used.
                </p>
              )}
              <span className="text-xs text-neutral-400">
                Output: MP4 (video + audio merged).
              </span>
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-300">
                  Format
                </span>
                <select
                  value={audioFormat}
                  onChange={(e) => setAudioFormat(e.target.value as AudioFormat)}
                  disabled={isBusy}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm uppercase disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {AUDIO_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-neutral-600 dark:text-neutral-300">
                  Bitrate
                </span>
                <select
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {BITRATES.map((b) => (
                    <option key={b} value={b}>
                      {b} kbps
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isBusy}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {download.status === "starting"
              ? "Preparing…"
              : download.status === "active"
                ? "Downloading…"
                : kind === "video"
                  ? "Download video"
                  : "Download audio"}
          </button>

          {/* Progress */}
          {(download.status === "active" || download.status === "starting") && (
            <ProgressBar state={download} />
          )}

          {download.status === "complete" && (
            <p className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
              Done — your file should be downloading. If not,{" "}
              <span className="font-medium">check your browser downloads</span>.
            </p>
          )}

          {download.status === "error" && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              {download.message}
            </p>
          )}
        </section>
      )}
    </div>
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
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>{PHASE_LABELS[phase]}</span>
        <span className="tabular-nums">
          {progress?.speed ? `${progress.speed}` : ""}
          {progress?.eta ? ` · ETA ${progress.eta}` : ""}
          {!indeterminate ? ` · ${percent.toFixed(1)}%` : ""}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-full rounded-full bg-red-600 transition-[width] duration-200 ${
            indeterminate ? "animate-pulse" : ""
          }`}
          style={{ width: indeterminate ? "100%" : `${percent}%` }}
        />
      </div>
    </div>
  );
}
