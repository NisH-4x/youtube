import { NextResponse } from "next/server";

import { parseYouTubeUrl } from "@/lib/validate";
import { fetchVideoInfo, BinaryNotFoundError, YtDlpError } from "@/lib/ytdlp";
import type { ApiError, VideoInfo } from "@/lib/types";

// Must run on the Node.js runtime: we spawn external binaries here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/info
 * Body: { url: string }
 * Returns normalized VideoInfo, or a 4xx/5xx with { error }.
 */
export async function POST(request: Request): Promise<NextResponse<VideoInfo | ApiError>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string") {
    return NextResponse.json({ error: "Missing URL." }, { status: 400 });
  }

  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    return NextResponse.json(
      { error: "That does not look like a valid YouTube video URL." },
      { status: 400 }
    );
  }

  try {
    const info = await fetchVideoInfo(parsed.canonicalUrl);
    return NextResponse.json(info);
  } catch (err) {
    if (err instanceof BinaryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof YtDlpError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to fetch video information." },
      { status: 500 }
    );
  }
}
