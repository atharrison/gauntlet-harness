import { type NextRequest } from 'next/server'
import { createReviewContext } from '../../../../src/harness/context'
import { runReview } from '../../../../src/agents/pr-review/coordinator'
import {
  cacheReview,
  getCachedReview,
  type CachedCheckpoint,
} from '../../../../src/harness/review-cache'

// Allow up to 5 minutes for the full multi-agent review pipeline
export const maxDuration = 300

/**
 * GET /api/review/[id]?prUrl=<encoded>&mode=full|quick
 * Server-Sent Events stream for live review progress.
 *
 * Event types emitted:
 *   connected   { reviewId, prUrl }
 *   checkpoint  { stage, status, reviewId }
 *   finding     { finding: Finding }
 *   alarm       { alarm }
 *   error       { error: string }
 *   done        { reviewId }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params
  const { searchParams } = new URL(request.url)
  const prUrl = searchParams.get('prUrl') ?? ''
  const rawMode = searchParams.get('mode')
  const mode: 'full' | 'quick' = rawMode === 'quick' ? 'quick' : 'full'

  const encoder = new TextEncoder()
  // Accumulate checkpoint events emitted during a fresh run so they can be
  // faithfully replayed on cache hits rather than reconstructed from a
  // hardcoded agent list.
  const checkpointLog: CachedCheckpoint[] = []

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (event === 'checkpoint') checkpointLog.push(data as CachedCheckpoint)
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      send('connected', { reviewId, prUrl, message: 'Stream connected' })

      if (!prUrl) {
        send('error', { error: 'prUrl query param is required' })
        send('done', { reviewId })
        controller.close()
        return
      }

      // If this review was already completed, replay from cache instantly
      // rather than re-running the agents (handles page refresh / re-visits).
      const cached = getCachedReview(reviewId)
      if (cached) {
        try {
          send('connected', {
            reviewId,
            prUrl,
            cached: true,
            message: 'Loaded from cache',
          })
          // Replay the exact checkpoint sequence from the original run —
          // preserves agent count and order without hardcoding agent names.
          for (const cp of cached.checkpoints) {
            send('checkpoint', cp)
          }
          const allFindings = [
            ...cached.review.blockingIssues,
            ...cached.review.suggestions,
            ...cached.review.nits,
          ]
          for (const finding of allFindings) {
            send('finding', { finding })
          }
          send('done', { reviewId })
        } finally {
          controller.close()
        }
        return
      }

      try {
        const context = createReviewContext()
        const review = await runReview({
          reviewId,
          prUrl,
          mode,
          context,
          emit: send,
        })
        cacheReview(reviewId, prUrl, review, checkpointLog)
      } catch (err) {
        console.error(`[review/${reviewId}] runReview failed:`, err)
        send('error', { error: String(err) })
        send('done', { reviewId })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
