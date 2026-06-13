import { type NextRequest } from "next/server";

/**
 * GET /api/review/[id]
 * Server-Sent Events stream for live review progress.
 * Agents fan-out wired in FIR-8 — this is the SSE stub.
 *
 * Event types emitted (once wired):
 *   - checkpoint  { stage, status, timestamp }
 *   - finding     { finding: Finding }
 *   - alarm       { alarm: Alarm }
 *   - done        { reviewId }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reviewId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      // Stub: emit a single "connected" event then close
      send("connected", { reviewId, message: "Stream connected (stub)" });
      send("done", { reviewId });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
