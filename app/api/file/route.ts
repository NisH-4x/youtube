import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getJob } from "@/lib/ytdlp";

// Must run on the Node.js runtime: reads files from disk and streams them.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pick a reasonable Content-Type from the output extension. */
function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

/**
 * Build a Content-Disposition value with an ASCII fallback plus an RFC 5987
 * UTF-8 encoded name, so titles with non-ASCII characters download correctly.
 */
function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/file?jobId=...
 * Streams the finished file to the browser, then deletes the job's temp dir.
 */
export async function GET(request: Request): Promise<Response> {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return new Response("Unknown or expired job.", { status: 404 });
  }
  if (job.progress.status === "error") {
    return new Response(job.progress.error ?? "Download failed.", { status: 500 });
  }
  if (!job.isFinished() || !job.filePath || !job.fileName) {
    return new Response("Download is not ready yet.", { status: 409 });
  }

  const filePath = job.filePath;
  const fileName = job.fileName;
  const ext = fileName.slice(fileName.lastIndexOf("."));

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return new Response("File is no longer available.", { status: 410 });
  }

  const nodeStream = createReadStream(filePath);
  // Once the response body is fully read (or the client aborts), drop the job
  // and its temp directory. cancel() kills any process and removes the dir.
  const cleanup = () => job.cancel();
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "Content-Type": contentTypeFor(ext),
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(fileName),
      "Cache-Control": "no-store",
    },
  });
}
