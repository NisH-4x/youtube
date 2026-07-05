import { NextResponse } from "next/server";

import { validateDownloadRequest } from "@/lib/validate";
import { startDownload, YtDlpError } from "@/lib/ytdlp";
import type { ApiError, DownloadStartResponse } from "@/lib/types";

// Must run on the Node.js runtime: we spawn external binaries here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/download
 * Body: DownloadRequest
 * Starts a yt-dlp job and returns its id. The client then opens an SSE stream
 * at /api/progress and finally GETs /api/file to receive the bytes.
 */
export async function POST(
  request: Request
): Promise<NextResponse<DownloadStartResponse | ApiError>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateDownloadRequest(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const jobId = await startDownload(validated.value);
    return NextResponse.json({ jobId });
  } catch (err) {
    if (err instanceof YtDlpError) {
      // Concurrency cap or similar expected condition.
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: "Failed to start download." },
      { status: 500 }
    );
  }
}
