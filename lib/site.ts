/**
 * Central site configuration used by metadata, robots, sitemap, and structured
 * data. Override the URL/name per deployment via environment variables:
 *
 *   NEXT_PUBLIC_SITE_URL   e.g. https://vidfetch.vercel.app
 *   NEXT_PUBLIC_SITE_NAME  e.g. VidFetch
 *
 * Both fall back to sensible defaults so the app still builds without them.
 */

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://grabmp4.vercel.app/"
).replace(/\/+$/, "");

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "YouTube Downloader";

/** Primary one-line description reused across metadata and structured data. */
export const SITE_DESCRIPTION =
  "Download YouTube videos in HD (720p, 1080p, 4K) as MP4, or extract audio as " +
  "MP3/M4A. Free, fast, no ads and no signup — just paste a link.";
