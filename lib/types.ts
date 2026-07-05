/**
 * Shared type definitions used by both the server (route handlers, yt-dlp
 * wrapper) and the client UI. Keeping them here means the SSE event shape and
 * the video-info shape can never drift between the two sides.
 */

/** A single selectable video resolution derived from yt-dlp's format list. */
export interface VideoResolution {
  /** Vertical resolution in pixels, e.g. 1080. */
  height: number;
  /** Human label, e.g. "1080p". */
  label: string;
  /** Frames per second when known (e.g. 60 for 1080p60). */
  fps: number | null;
}

/** Normalized metadata returned by the /api/info endpoint. */
export interface VideoInfo {
  id: string;
  title: string;
  uploader: string;
  /** Duration in whole seconds. */
  duration: number;
  /** Pre-formatted duration string, e.g. "12:34". */
  durationString: string;
  thumbnail: string | null;
  /** Distinct video resolutions offered, sorted descending by height. */
  resolutions: VideoResolution[];
  webpageUrl: string;
}

/** The kind of download the user requested. */
export type DownloadKind = "video" | "audio";

/** Supported audio container/codec targets for audio-only downloads. */
export type AudioFormat = "mp3" | "m4a";

/** A download request coming from the client. */
export interface DownloadRequest {
  url: string;
  kind: DownloadKind;
  /** Max video height for `kind: "video"` (e.g. 1080, 1440, 2160). */
  height?: number;
  /** Target audio format for `kind: "audio"`. */
  audioFormat?: AudioFormat;
  /** Audio bitrate in kbps for `kind: "audio"` (e.g. 128, 192, 320). */
  audioBitrate?: number;
}

/** Lifecycle states for a download job. */
export type JobStatus = "running" | "complete" | "error" | "canceled";

/**
 * A progress snapshot pushed over SSE. `percent` is 0–100. Speed and ETA are
 * kept as yt-dlp's already-formatted display strings for the UI.
 */
export interface ProgressEvent {
  status: JobStatus;
  /** 0–100, or null before the first progress line arrives. */
  percent: number | null;
  /** e.g. "1.23MiB/s" or null. */
  speed: string | null;
  /** e.g. "00:42" or null. */
  eta: string | null;
  /** Which stream is being processed, for UIs that want to show it. */
  phase: "downloading" | "merging" | "converting" | "starting" | "done";
  /** Present only when status === "error". */
  error?: string;
}

/** Response body from POST /api/download when a job is accepted. */
export interface DownloadStartResponse {
  jobId: string;
}

/** Generic API error body. */
export interface ApiError {
  error: string;
}
