import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ProgressEvent,
  VideoInfo,
  VideoResolution,
} from "./types";
import { sanitizeFilename, type ValidatedDownload } from "./validate";

/**
 * Wrapper around the `yt-dlp` and (indirectly) `ffmpeg` binaries. All process
 * spawning goes through here so route handlers stay thin and this logic stays
 * testable. Every spawn uses an argv ARRAY (never a shell string), so the
 * user's URL and options can never be interpreted as shell syntax.
 */

/** Binary names/paths. Overridable via env for unusual install locations. */
const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
/**
 * Optional explicit path to the ffmpeg binary (or its directory). When set we
 * pass it to yt-dlp via --ffmpeg-location so merging/extraction works even if
 * ffmpeg is not on the server process's PATH.
 */
const FFMPEG_PATH = process.env.FFMPEG_PATH || "";

/**
 * Optional YouTube authentication. When the app runs on a cloud/datacenter IP
 * (Render, Railway, Fly, etc.) YouTube frequently returns "Sign in to confirm
 * you're not a bot" and requires cookies from a logged-in session. Set ONE of:
 *   YTDLP_COOKIES               -> path to a Netscape-format cookies.txt file
 *   YTDLP_COOKIES_FROM_BROWSER  -> a browser name (only useful for local runs)
 */
const YTDLP_COOKIES = process.env.YTDLP_COOKIES || "";
const YTDLP_COOKIES_FROM_BROWSER = process.env.YTDLP_COOKIES_FROM_BROWSER || "";

/** Cookie/auth argv shared by the info fetch and the download. */
function authArgs(): string[] {
  if (YTDLP_COOKIES) return ["--cookies", YTDLP_COOKIES];
  if (YTDLP_COOKIES_FROM_BROWSER) {
    return ["--cookies-from-browser", YTDLP_COOKIES_FROM_BROWSER];
  }
  return [];
}

/** Sentinel prefix we emit from yt-dlp's --progress-template so we can find it. */
const PROGRESS_PREFIX = "[[PROG]]";

/** Max wall-clock time for a metadata fetch before we give up. */
const INFO_TIMEOUT_MS = 30_000;

/** How many downloads may run at once across the whole server. */
const MAX_CONCURRENT_DOWNLOADS = 3;

/** How long a finished job's files linger before automatic cleanup. */
const JOB_TTL_MS = 10 * 60_000;

/** Raised when a spawn fails because the binary is not installed. */
export class BinaryNotFoundError extends Error {
  constructor(bin: string) {
    super(
      `Required binary "${bin}" was not found on PATH. Install yt-dlp and ffmpeg (see README).`
    );
    this.name = "BinaryNotFoundError";
  }
}

/** Raised for expected yt-dlp failures with a user-friendly message. */
export class YtDlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YtDlpError";
  }
}

// ---------------------------------------------------------------------------
// Metadata fetch
// ---------------------------------------------------------------------------

/** The subset of yt-dlp's --dump-single-json output that we consume. */
interface RawFormat {
  vcodec?: string;
  acodec?: string;
  height?: number | null;
  fps?: number | null;
}

interface RawInfo {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number | null;
  duration_string?: string;
  thumbnail?: string | null;
  webpage_url?: string;
  formats?: RawFormat[];
}

/** Format a whole-second duration as H:MM:SS or M:SS. */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Collapse the raw format list into distinct, sorted video resolutions. */
function extractResolutions(formats: RawFormat[]): VideoResolution[] {
  const byHeight = new Map<number, VideoResolution>();
  for (const f of formats) {
    // Video streams only: vcodec present and not the literal "none".
    if (!f.vcodec || f.vcodec === "none") continue;
    if (!f.height || f.height <= 0) continue;
    const fps = typeof f.fps === "number" && f.fps > 0 ? Math.round(f.fps) : null;
    const existing = byHeight.get(f.height);
    if (!existing || (fps ?? 0) > (existing.fps ?? 0)) {
      byHeight.set(f.height, {
        height: f.height,
        label: fps && fps >= 50 ? `${f.height}p${fps}` : `${f.height}p`,
        fps,
      });
    }
  }
  return Array.from(byHeight.values()).sort((a, b) => b.height - a.height);
}

/**
 * Fetch and normalize video metadata via `yt-dlp --dump-single-json`.
 * The URL must already be a canonicalized, validated YouTube watch URL.
 */
export async function fetchVideoInfo(canonicalUrl: string): Promise<VideoInfo> {
  const { stdout } = await runToCompletion(
    YTDLP_BIN,
    [
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      ...authArgs(),
      canonicalUrl,
    ],
    INFO_TIMEOUT_MS
  );

  let raw: RawInfo;
  try {
    raw = JSON.parse(stdout) as RawInfo;
  } catch {
    throw new YtDlpError("Could not parse video information from yt-dlp.");
  }

  const duration = typeof raw.duration === "number" ? raw.duration : 0;

  return {
    id: raw.id ?? "",
    title: raw.title ?? "Untitled",
    uploader: raw.uploader ?? raw.channel ?? "Unknown",
    duration,
    durationString: raw.duration_string || formatDuration(duration),
    thumbnail: raw.thumbnail ?? null,
    resolutions: extractResolutions(raw.formats ?? []),
    webpageUrl: raw.webpage_url ?? canonicalUrl,
  };
}

/**
 * Run a command to completion, buffering stdout/stderr. Rejects with a
 * friendly error on non-zero exit, missing binary, or timeout. Used for the
 * short-lived metadata fetch (not for streaming downloads).
 */
function runToCompletion(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { shell: false });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new YtDlpError("Timed out fetching video information."));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new BinaryNotFoundError(bin));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new YtDlpError(friendlyError(stderr)));
      }
    });
  });
}

/** Translate raw yt-dlp stderr into a concise, user-facing message. */
function friendlyError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes("confirm your age") || text.includes("age-restricted")) {
    return "This video is age-restricted and cannot be downloaded without sign-in.";
  }
  if (text.includes("private video")) {
    return "This video is private.";
  }
  if (text.includes("members-only") || text.includes("members only")) {
    return "This video is members-only.";
  }
  if (
    text.includes("video unavailable") ||
    text.includes("is not available") ||
    text.includes("removed by the uploader") ||
    text.includes("account associated with this video has been terminated")
  ) {
    return "This video is unavailable.";
  }
  if (text.includes("is not a valid url") || text.includes("unsupported url")) {
    return "That URL is not supported.";
  }
  if (
    text.includes("confirm you’re not a bot") ||
    text.includes("confirm you're not a bot") ||
    text.includes("sign in to confirm")
  ) {
    return (
      "YouTube is blocking this server's IP and asking for sign-in. Provide " +
      "YouTube cookies via the YTDLP_COOKIES setting (see README), or run the " +
      "app from a home/residential connection."
    );
  }
  // Fall back to the last meaningful ERROR: line, if any.
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errLine = [...lines].reverse().find((l) => l.startsWith("ERROR:"));
  if (errLine) return errLine.replace(/^ERROR:\s*/, "");
  return lines[lines.length - 1] || "yt-dlp failed with an unknown error.";
}

// ---------------------------------------------------------------------------
// Download jobs
// ---------------------------------------------------------------------------

/**
 * A single in-flight (or completed) download. Progress is broadcast via an
 * EventEmitter; the latest snapshot is cached so a late SSE subscriber gets the
 * current state immediately.
 */
class DownloadJob {
  readonly id: string;
  readonly tmpDir: string;
  private readonly emitter = new EventEmitter();
  private child: ChildProcessWithoutNullStreams | null = null;
  private stderrBuf = "";

  progress: ProgressEvent = {
    status: "running",
    percent: null,
    speed: null,
    eta: null,
    phase: "starting",
  };

  /** Absolute path to the finished file, set on successful completion. */
  filePath: string | null = null;
  /** Suggested download filename (sanitized title + extension). */
  fileName: string | null = null;

  private cleanupTimer: NodeJS.Timeout | null = null;
  private done = false;

  constructor(id: string, tmpDir: string) {
    this.id = id;
    this.tmpDir = tmpDir;
    this.emitter.setMaxListeners(0);
  }

  /** Subscribe to progress updates. Immediately emits the current snapshot. */
  subscribe(listener: (p: ProgressEvent) => void): () => void {
    listener(this.progress);
    this.emitter.on("progress", listener);
    return () => this.emitter.off("progress", listener);
  }

  private emit(next: Partial<ProgressEvent>) {
    this.progress = { ...this.progress, ...next };
    this.emitter.emit("progress", this.progress);
  }

  /** Attach the spawned child process and wire up its output parsing. */
  attach(child: ChildProcessWithoutNullStreams) {
    this.child = child;

    child.stdout.setEncoding("utf8");
    let stdoutTail = "";
    child.stdout.on("data", (chunk: string) => {
      stdoutTail += chunk;
      const lines = stdoutTail.split(/\r?\n/);
      stdoutTail = lines.pop() ?? "";
      for (const line of lines) this.handleStdoutLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuf += chunk;
      // Cap buffered stderr so a chatty run can't grow memory unbounded.
      if (this.stderrBuf.length > 64_000) {
        this.stderrBuf = this.stderrBuf.slice(-64_000);
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        this.fail(new BinaryNotFoundError(YTDLP_BIN).message);
      } else {
        this.fail(err.message);
      }
    });

    child.on("close", (code) => {
      void this.onClose(code);
    });
  }

  private handleStdoutLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith(PROGRESS_PREFIX)) {
      // Format: [[PROG]]<percent>;<speed>;<eta>
      const payload = trimmed.slice(PROGRESS_PREFIX.length);
      const [percentStr, speedStr, etaStr] = payload.split(";");
      const percentNum = parseFloat((percentStr || "").replace(/[^0-9.]/g, ""));
      this.emit({
        phase: "downloading",
        percent: Number.isFinite(percentNum) ? Math.min(100, percentNum) : this.progress.percent,
        speed: cleanField(speedStr),
        eta: cleanField(etaStr),
      });
      return;
    }

    // Post-processing phase markers printed by yt-dlp.
    if (trimmed.includes("[Merger]")) {
      this.emit({ phase: "merging", percent: 100, speed: null, eta: null });
    } else if (trimmed.includes("[ExtractAudio]")) {
      this.emit({ phase: "converting", percent: 100, speed: null, eta: null });
    }
  }

  private async onClose(code: number | null) {
    if (this.done) return;

    if (code !== 0) {
      this.fail(friendlyError(this.stderrBuf));
      return;
    }

    // Locate the finished output file in our private temp dir.
    try {
      const entries = await fs.readdir(this.tmpDir);
      const finished = entries.find(
        (name) =>
          !name.endsWith(".part") &&
          !name.endsWith(".ytdl") &&
          !name.endsWith(".temp") &&
          !name.endsWith(".part-Frag")
      );
      if (!finished) {
        this.fail("Download completed but no output file was produced.");
        return;
      }
      const abs = path.join(this.tmpDir, finished);
      const ext = path.extname(finished);
      const base = sanitizeFilename(path.basename(finished, ext));
      this.filePath = abs;
      this.fileName = `${base}${ext}`;
      this.done = true;
      this.emit({ status: "complete", phase: "done", percent: 100, speed: null, eta: null });
      this.scheduleCleanup();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : "Failed to finalize download.");
    }
  }

  private fail(message: string) {
    if (this.done) return;
    this.done = true;
    this.emit({ status: "error", error: message });
    // Clean up promptly on failure; nothing will be streamed.
    void removeDir(this.tmpDir);
    this.scheduleCleanup(5_000);
  }

  /** Kill the process (if any) and drop the job. */
  cancel() {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGKILL");
    }
    if (!this.done) {
      this.done = true;
      this.emit({ status: "canceled" });
    }
    void removeDir(this.tmpDir);
    jobs.delete(this.id);
  }

  private scheduleCleanup(delay = JOB_TTL_MS) {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      void removeDir(this.tmpDir);
      jobs.delete(this.id);
    }, delay);
    // Don't keep the event loop alive just for cleanup.
    this.cleanupTimer.unref?.();
  }

  isFinished() {
    return this.done;
  }
}

/**
 * Registry of live jobs, keyed by id. Pinned to `globalThis` so it is a true
 * singleton even if this module gets evaluated more than once — which happens
 * in Next.js dev mode (per-route compilation / HMR) and would otherwise give
 * different route handlers their own private, empty registry.
 */
const globalForJobs = globalThis as unknown as {
  __ytdlJobs?: Map<string, DownloadJob>;
};
const jobs: Map<string, DownloadJob> =
  globalForJobs.__ytdlJobs ?? (globalForJobs.__ytdlJobs = new Map());

/** Number of jobs currently in the "running" state. */
function activeCount(): number {
  let n = 0;
  for (const job of jobs.values()) {
    if (job.progress.status === "running") n += 1;
  }
  return n;
}

/** Trim leading/trailing whitespace; map yt-dlp's "Unknown"/"N/A" to null. */
function cleanField(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || v === "Unknown" || v === "NA" || v === "N/A") return null;
  return v;
}

/** Build the yt-dlp argv for a validated download request. */
function buildDownloadArgs(req: ValidatedDownload, outputTemplate: string): string[] {
  const common = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--progress-template",
    `download:${PROGRESS_PREFIX}%(progress._percent_str)s;%(progress._speed_str)s;%(progress._eta_str)s`,
    "-o",
    outputTemplate,
    // Point yt-dlp at ffmpeg explicitly when a path is configured.
    ...(FFMPEG_PATH ? ["--ffmpeg-location", FFMPEG_PATH] : []),
    // YouTube cookies for cloud/datacenter IPs, when configured.
    ...authArgs(),
  ];

  if (req.kind === "audio") {
    return [
      ...common,
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      req.audioFormat,
      // For mp3 we pass an explicit kbps target; --audio-quality 0 = best VBR.
      "--audio-quality",
      `${req.audioBitrate}K`,
      req.canonicalUrl,
    ];
  }

  // Video: MERGE bestvideo+bestaudio so we are not capped at ~720p progressive.
  const height = req.height ?? 1080;
  return [
    ...common,
    "-f",
    `bestvideo[height<=?${height}]+bestaudio/best[height<=?${height}]/best`,
    "--merge-output-format",
    "mp4",
    req.canonicalUrl,
  ];
}

/**
 * Start a download job. Spawns yt-dlp into a private per-job temp directory and
 * returns the job id. Throws YtDlpError when the concurrency cap is reached.
 */
export async function startDownload(req: ValidatedDownload): Promise<string> {
  if (activeCount() >= MAX_CONCURRENT_DOWNLOADS) {
    throw new YtDlpError(
      "The server is busy with other downloads. Please try again in a moment."
    );
  }

  const id = randomUUID();
  const tmpDir = path.join(os.tmpdir(), `ytdl-${id}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, "%(title).100s.%(ext)s");
  const args = buildDownloadArgs(req, outputTemplate);

  const job = new DownloadJob(id, tmpDir);
  jobs.set(id, job);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(YTDLP_BIN, args, { shell: false });
  } catch (err) {
    await removeDir(tmpDir);
    jobs.delete(id);
    throw err;
  }
  job.attach(child);

  return id;
}

export function getJob(id: string): DownloadJob | undefined {
  return jobs.get(id);
}

/** Remove a directory tree, ignoring errors (best-effort cleanup). */
async function removeDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export type { DownloadJob };
