import type { AudioFormat, DownloadRequest, DownloadKind } from "./types";

/**
 * Hostnames we accept as YouTube. We are deliberately strict: only these hosts
 * (and their `www.`/`m.`/`music.` variants) are allowed. This is the first line
 * of defense before the URL is ever handed to yt-dlp.
 */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/** A YouTube video id is exactly 11 URL-safe base64 chars. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface ParsedYouTubeUrl {
  /** The 11-char video id. */
  videoId: string;
  /** A canonical https watch URL safe to hand to yt-dlp. */
  canonicalUrl: string;
}

/**
 * Validate and canonicalize a user-supplied YouTube URL.
 *
 * Returns the extracted video id and a canonical watch URL, or null if the
 * input is not a recognizable YouTube *video* URL. We build a brand-new URL
 * from the parsed id rather than forwarding the raw input, so nothing the user
 * typed (query params, fragments, extra path segments) reaches yt-dlp verbatim.
 */
export function parseYouTubeUrl(raw: string): ParsedYouTubeUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  let videoId: string | null = null;

  if (parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be") {
    // Short form: https://youtu.be/<id>
    videoId = parsed.pathname.slice(1).split("/")[0] || null;
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v");
  } else if (parsed.pathname.startsWith("/shorts/")) {
    videoId = parsed.pathname.split("/")[2] || null;
  } else if (parsed.pathname.startsWith("/embed/")) {
    videoId = parsed.pathname.split("/")[2] || null;
  } else if (parsed.pathname.startsWith("/live/")) {
    videoId = parsed.pathname.split("/")[2] || null;
  }

  if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

const ALLOWED_HEIGHTS = new Set([144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]);
const ALLOWED_AUDIO_FORMATS = new Set<AudioFormat>(["mp3", "m4a"]);
const ALLOWED_BITRATES = new Set([64, 96, 128, 192, 256, 320]);

export interface ValidatedDownload {
  canonicalUrl: string;
  videoId: string;
  kind: DownloadKind;
  height: number | null;
  audioFormat: AudioFormat;
  audioBitrate: number;
}

/**
 * Validate an untrusted download request body. Returns either a fully-typed,
 * whitelisted request or an error message. Every numeric/enum option is checked
 * against an allow-list so that nothing arbitrary flows into the yt-dlp argv.
 */
export function validateDownloadRequest(
  body: unknown
): { ok: true; value: ValidatedDownload } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const req = body as Partial<DownloadRequest>;

  if (typeof req.url !== "string") {
    return { ok: false, error: "Missing URL." };
  }
  const parsed = parseYouTubeUrl(req.url);
  if (!parsed) {
    return { ok: false, error: "That does not look like a valid YouTube video URL." };
  }

  const kind: DownloadKind = req.kind === "audio" ? "audio" : "video";

  let height: number | null = null;
  if (kind === "video") {
    if (typeof req.height !== "number" || !ALLOWED_HEIGHTS.has(req.height)) {
      return { ok: false, error: "Unsupported video resolution." };
    }
    height = req.height;
  }

  let audioFormat: AudioFormat = "mp3";
  let audioBitrate = 192;
  if (kind === "audio") {
    if (req.audioFormat !== undefined) {
      if (!ALLOWED_AUDIO_FORMATS.has(req.audioFormat)) {
        return { ok: false, error: "Unsupported audio format." };
      }
      audioFormat = req.audioFormat;
    }
    if (req.audioBitrate !== undefined) {
      if (typeof req.audioBitrate !== "number" || !ALLOWED_BITRATES.has(req.audioBitrate)) {
        return { ok: false, error: "Unsupported audio bitrate." };
      }
      audioBitrate = req.audioBitrate;
    }
  }

  return {
    ok: true,
    value: {
      canonicalUrl: parsed.canonicalUrl,
      videoId: parsed.videoId,
      kind,
      height,
      audioFormat,
      audioBitrate,
    },
  };
}

// Characters illegal in filenames on Windows, plus path separators.
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;
// ASCII control characters (0x00-0x1f and 0x7f). Built via RegExp so no literal
// control bytes ever appear in this source file.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Turn a video title into a safe filename base (no extension). Strips path
 * separators, control chars, and characters illegal on Windows/macOS/Linux,
 * collapses whitespace, and caps length. Never returns an empty string.
 */
export function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(CONTROL_CHARS, "")
    .replace(ILLEGAL_FILENAME_CHARS, "")
    .replace(/[.\s]+$/g, "") // trailing dots/spaces (Windows)
    .replace(/\s+/g, " ")
    .trim();
  const capped = cleaned.slice(0, 120).trim();
  return capped.length > 0 ? capped : "video";
}
