import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getCachedReview,
  invalidateCachedReview,
} from '../../../../../src/harness/review-cache'
import { createMemoryStore } from '../../../../../src/memory/index'
import {
  formatGitHubComment,
  buildSubmission,
} from '../../../../../src/agents/pr-review/approval'
import { createOctokit } from '../../../../../src/tools/github'
import type { FindingDecision } from '../../../../../src/agents/pr-review/schema'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FindingDecisionInput = z.object({
  findingId: z.string(),
  action: z.enum(['ACCEPT', 'REJECT', 'EDIT']),
  editedTitle: z.string().optional(),
  editedBody: z.string().optional(),
})

const FinalizeBody = z.object({
  decisions: z.array(FindingDecisionInput).min(1),
  postComment: z.boolean().default(false),
})

// ── POST /api/review/[id]/finalize ────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reviewId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = FinalizeBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { decisions: rawDecisions, postComment } = parsed.data

  // ── Load PRReview from in-process cache ───────────────────────────────────
  const cached = getCachedReview(reviewId)
  if (!cached) {
    return NextResponse.json(
      { error: 'Review not found or expired. Reviews are cached for 1 hour.' },
      { status: 404 }
    )
  }
  const { review, prUrl } = cached

  // ── Build FindingDecision map from the submitted decisions ────────────────
  const decisionMap: Record<string, FindingDecision> = {}
  for (const d of rawDecisions) {
    decisionMap[d.findingId] = {
      findingId: d.findingId,
      action: d.action,
      editedTitle: d.editedTitle,
      editedBody: d.editedBody,
    }
  }

  const submission = buildSubmission(
    {
      reviewId,
      decisions: decisionMap,
      submitting: false,
      submitted: true,
      result: null,
    },
    postComment
  )

  // ── Persist to memory store ───────────────────────────────────────────────
  const memory = createMemoryStore()
  const accepted = rawDecisions.filter(d => d.action !== 'REJECT').length
  const rejected = rawDecisions.filter(d => d.action === 'REJECT').length

  const prUrlParts = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)

  await memory
    .storeReview(
      { review, submission },
      {
        prUrl,
        repoName: prUrlParts
          ? `${prUrlParts[1]}/${prUrlParts[2]}`
          : 'unknown/unknown',
        prTitle: review.summary.slice(0, 80),
        author: 'unknown',
        prNumber: prUrlParts ? Number(prUrlParts[3]) : 0,
      }
    )
    .catch(err => {
      // Non-fatal — log but don't fail the request
      console.error('[finalize] storeReview failed:', err)
    })

  // ── Optionally post GitHub comment ────────────────────────────────────────
  let commentResult: unknown = null
  if (postComment) {
    const octokit = createOctokit()
    if (!octokit) {
      commentResult = { skipped: true, reason: 'GITHUB_TOKEN not configured' }
    } else if (!prUrlParts) {
      commentResult = {
        skipped: true,
        reason: 'Could not parse prUrl for GitHub API',
      }
    } else {
      const commentBody = formatGitHubComment(review, submission)
      const dryRun = process.env.DRY_RUN === 'true'
      if (dryRun) {
        commentResult = { dryRun: true, body: commentBody }
      } else {
        try {
          const { data } = await octokit.issues.createComment({
            owner: prUrlParts[1],
            repo: prUrlParts[2],
            issue_number: Number(prUrlParts[3]),
            body: commentBody,
          })
          commentResult = { id: data.id, url: data.html_url }
        } catch (err) {
          commentResult = { error: String(err) }
        }
      }
    }
  }

  // Invalidate cache so the review cannot be double-submitted
  invalidateCachedReview(reviewId)

  return NextResponse.json({
    reviewId,
    status: 'finalized',
    summary: {
      totalDecisions: rawDecisions.length,
      accepted,
      rejected,
    },
    comment: commentResult,
  })
}
