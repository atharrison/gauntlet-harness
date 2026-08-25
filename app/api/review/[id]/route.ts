import { type NextRequest } from 'next/server'
import { createReviewContext } from '../../../../src/harness/context'
import { runReview } from '../../../../src/agents/pr-review/coordinator'
import {
  createReview,
  completeReview,
  failReview,
  getReview,
} from '../../../../src/memory/review-store'
import { getGitHubToken } from '../../../../src/lib/supabase/server'

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
 *   stats       { tokensUsed, estimatedCostUsd, durationMs, findingsCount, phaseDurations }
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

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
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

      // Check if this review already completed (page refresh / re-visit).
      // Load from Supabase and replay findings without re-running the pipeline.
      let existing = null
      try {
        existing = await getReview(reviewId)
      } catch (err) {
        console.warn(`[review/${reviewId}] getReview check failed:`, err)
      }

      if (existing?.status === 'COMPLETE' && existing.result) {
        const review = existing.result
        send('connected', {
          reviewId,
          prUrl,
          cached: true,
          message: 'Loaded from database',
        })
        // Replay synthetic pipeline checkpoints so the UI renders all stages
        const stages = ['INPUT', 'CONTEXT', 'DOMAIN', 'OUTPUT']
        for (const stage of stages) {
          send('checkpoint', { stage, status: 'PASS', reviewId })
        }
        const allFindings = [
          ...(review.blockingIssues ?? []),
          ...(review.suggestions ?? []),
          ...(review.nits ?? []),
        ]
        for (const finding of allFindings) {
          send('finding', { finding })
        }
        send('done', { reviewId })
        controller.close()
        return
      }

      if (existing?.status === 'ERROR') {
        send('error', {
          error: 'Review failed. Check server logs for details.',
        })
        send('done', { reviewId })
        controller.close()
        return
      }

      // Fresh run — create the review row if start didn't already, then run
      // the pipeline. Duplicate insert is skipped so ATH-15 can mint the row
      // in /api/review/start (needed for tracked_prs.last_review_id FK).
      if (!existing) {
        try {
          await createReview(reviewId, prUrl, mode)
        } catch (err) {
          console.error(`[review/${reviewId}] createReview failed:`, err)
          send('error', {
            error:
              'Failed to initialize review — database write error. Check server logs for details.',
          })
          send('done', { reviewId })
          controller.close()
          return
        }
      }

      try {
        // Prefer the OAuth provider token from the user's GitHub session;
        // falls back to GITHUB_TOKEN env var if not available.
        const githubToken = await getGitHubToken()
        const context = createReviewContext(undefined, githubToken)
        const review = await runReview({
          reviewId,
          prUrl,
          mode,
          context,
          emit: send,
        })
        await completeReview(reviewId, review).catch(err =>
          console.error(`[review/${reviewId}] completeReview failed:`, err)
        )
      } catch (err) {
        console.error(`[review/${reviewId}] runReview failed:`, err)
        await failReview(reviewId, String(err)).catch(() => {})
        send('error', {
          error: 'Review pipeline failed. Check server logs for details.',
        })
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
