import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

const StartReviewBody = z.object({
  prUrl: z.string().url('prUrl must be a valid GitHub PR URL'),
  mode: z.enum(['full', 'quick']).default('full'),
})

/**
 * POST /api/review/start
 * Validates the PR URL, mints a reviewId, and returns it.
 * Agents are wired in FIR-8 — this is the stub.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = StartReviewBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const reviewId = uuidv4()

  return NextResponse.json(
    { reviewId, prUrl: parsed.data.prUrl, mode: parsed.data.mode },
    { status: 202 }
  )
}

/**
 * GET /api/review/start?prUrl=...
 * Browser form fallback — redirects to the review page.
 */
const GithubPrUrl = z
  .string()
  .url()
  .refine(val => /^https:\/\/github\.com\/.+\/.+\/pull\/\d+/.test(val), {
    message: 'prUrl must be a GitHub PR URL',
  })

export function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const prUrl = searchParams.get('prUrl')

  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  const baseUrl = `${proto}://${host}`

  if (!prUrl) {
    return NextResponse.redirect(new URL('/?error=missing_pr_url', baseUrl))
  }

  const parsed = GithubPrUrl.safeParse(prUrl)
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/?error=invalid_pr_url', baseUrl))
  }

  const reviewId = uuidv4()
  // Use x-forwarded-host/proto so redirects work behind Railway's proxy.
  // request.url uses the internal binding address (0.0.0.0:PORT) which is wrong.
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  const baseUrl = `${proto}://${host}`
  return NextResponse.redirect(
    new URL(
      `/review/${reviewId}?prUrl=${encodeURIComponent(parsed.data)}`,
      baseUrl
    )
  )
}
