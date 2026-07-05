import { getJob } from "@/lib/ytdlp";
import type { ProgressEvent } from "@/lib/types";

// Must run on the Node.js runtime: reads from the in-memory job registry.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/progress?jobId=...
 * Server-Sent Events stream of ProgressEvent objects. The stream closes once
 * the job reaches a terminal state (complete / error / canceled).
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      // `subscribe` invokes the listener synchronously with the current
      // snapshot, which may already be terminal. So everything `finish` touches
      // must be initialized *before* we subscribe, or we hit a TDZ error.
      let unsubscribe: () => void = () => {};

      // Keep-alive comments so proxies don't close an idle connection.
      const keepAlive = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      keepAlive.unref?.();

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (event: ProgressEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (
          event.status === "complete" ||
          event.status === "error" ||
          event.status === "canceled"
        ) {
          finish();
        }
      };

      // Stop streaming if the client navigates away / aborts.
      request.signal.addEventListener("abort", finish);

      // Subscribe last: the synchronous initial emit may call finish().
      unsubscribe = job.subscribe(send);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
