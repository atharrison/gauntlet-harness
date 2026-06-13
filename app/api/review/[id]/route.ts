import { type NextRequest } from 'next/server'
import { createReviewContext } from '../../../../src/harness/context'
import { runReview } from '../../../../src/agents/pr-review/coordinator'

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

      try {
        const context = createReviewContext()
        await runReview({ reviewId, prUrl, mode, context, emit: send })
      } catch (err) {
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
