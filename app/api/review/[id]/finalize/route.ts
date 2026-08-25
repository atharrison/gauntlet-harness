import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getReview,
  setReviewSubmission,
} from '../../../../../src/memory/review-store'
import { createMemoryStore } from '../../../../../src/memory/index'
import {
  formatGitHubComment,
  formatApprovalComment,
  buildSubmission,
} from '../../../../../src/agents/pr-review/approval'
import { createOctokit } from '../../../../../src/tools/github'
import { getGitHubToken } from '../../../../../src/lib/supabase/server'
import { parsePrUrl } from '../../../../../src/lib/queue'
import { markPrReviewed } from '../../../../../src/memory/tracked-pr-store'
import type { FindingDecision } from '../../../../../src/agents/pr-review/schema'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FindingDecisionInput = z.object({
  findingId: z.string(),
  action: z.enum(['ACCEPT', 'REJECT', 'EDIT']),
  editedTitle: z.string().optional(),
  editedBody: z.string().optional(),
})

const FinalizeBody = z.object({
  decisions: z.array(FindingDecisionInput).default([]),
  postComment: z.boolean().default(false),
  approve: z.boolean().default(false),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mark the corresponding tracked_pr as REVIEWED and record which review
 * produced it. Awaited before the response is sent so the transition is
 * guaranteed to complete (important in serverless environments).
 *
 * `review_count` is incremented by the `tracked_prs_on_reviewed` DB trigger.
 */
async function markTrackedPrReviewed(
  prUrl: string,
  reviewId: string
): Promise<void> {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) return
  try {
    await markPrReviewed(parsed, reviewId)
  } catch (err) {
    console.error('[finalize] tracked_prs REVIEWED transition failed:', err)
  }
}

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

  const { decisions: rawDecisions, postComment, approve } = parsed.data

  // ── Load PRReview from Supabase ───────────────────────────────────────────
  let reviewRow
  try {
    reviewRow = await getReview(reviewId)
  } catch (err) {
    console.error(`[finalize/${reviewId}] getReview failed:`, err)
    return NextResponse.json(
      { error: 'Failed to load review.' },
      { status: 500 }
    )
  }
  if (!reviewRow || reviewRow.status !== 'COMPLETE' || !reviewRow.result) {
    return NextResponse.json(
      { error: 'Review not found or not yet complete.' },
      { status: 404 }
    )
  }
  const review = reviewRow.result
  const prUrl = reviewRow.pr_url

  // ── Mutual-exclusivity guards ─────────────────────────────────────────────
  // totalFindings includes all severities (blocking + suggestions + nits),
  // matching the UI's `total === 0` condition in ReviewShell which also counts
  // all findings. Both gates are intentionally strict: the Approve CTA only
  // appears and succeeds when the review is completely clean.
  const totalFindings =
    (review.blockingIssues?.length ?? 0) +
    (review.suggestions?.length ?? 0) +
    (review.nits?.length ?? 0)

  // Prevent a false LGTM comment being posted to a review that has findings.
  if (approve && totalFindings > 0) {
    return NextResponse.json(
      {
        error:
          'Cannot approve a review that has findings. Submit decisions instead.',
      },
      { status: 400 }
    )
  }

  // Prevent the normal submission path from silently succeeding with no decisions.
  // Error message is context-aware: if the review has no findings, guide caller
  // toward approve:true; if it has findings, guide them to supply decisions.
  if (!approve && rawDecisions.length === 0) {
    return NextResponse.json(
      {
        error:
          totalFindings === 0
            ? 'This review has no findings. Use approve:true to post a clean LGTM.'
            : 'decisions must not be empty for a findings submission.',
      },
      { status: 400 }
    )
  }

  // ── Two fully separate paths — approve (clean review) vs. submit (findings) ──

  const prUrlParts = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!prUrlParts) {
    console.warn(
      `[finalize/${reviewId}] prUrl could not be parsed — history metadata will be degraded. prUrl: ${prUrl}`
    )
  }
  const memory = createMemoryStore()
  const githubToken = await getGitHubToken()

  if (approve) {
    // ── Approve path: no findings, post LGTM comment ────────────────────────
    const approvalSubmission = buildSubmission(
      {
        reviewId,
        decisions: {},
        submitting: false,
        submitted: true,
        result: null,
      },
      postComment
    )
    await memory
      .storeReview(
        { review, submission: approvalSubmission },
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
      .catch(err => console.error('[finalize] storeReview failed:', err))

    let commentResult: unknown = null
    if (postComment) {
      const octokit = createOctokit(githubToken)
      if (!octokit) {
        commentResult = { skipped: true, reason: 'GITHUB_TOKEN not configured' }
      } else if (!prUrlParts) {
        commentResult = {
          skipped: true,
          reason: 'Could not parse prUrl for GitHub API',
        }
      } else {
        const commentBody = formatApprovalComment(review)
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

    try {
      await setReviewSubmission(reviewId, approvalSubmission)
    } catch (err) {
      console.error('[finalize] setReviewSubmission failed:', err)
      return NextResponse.json(
        { error: 'Failed to persist submission — please retry.' },
        { status: 500 }
      )
    }
    await markTrackedPrReviewed(prUrl, reviewId)
    return NextResponse.json({
      reviewId,
      status: 'approved',
      comment: commentResult,
      ...(prUrlParts
        ? {}
        : {
            warning:
              'prUrl could not be parsed — history metadata stored with placeholder values',
          }),
    })
  }

  // ── Submit path: build decision map, persist, post findings comment ────────
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

  const accepted = rawDecisions.filter(d => d.action !== 'REJECT').length
  const rejected = rawDecisions.filter(d => d.action === 'REJECT').length

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
    .catch(err => console.error('[finalize] storeReview failed:', err))

  let commentResult: unknown = null
  if (postComment) {
    const octokit = createOctokit(githubToken)
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

  try {
    await setReviewSubmission(reviewId, submission)
  } catch (err) {
    console.error('[finalize] setReviewSubmission failed:', err)
    return NextResponse.json(
      { error: 'Failed to persist submission — please retry.' },
      { status: 500 }
    )
  }
  await markTrackedPrReviewed(prUrl, reviewId)
  return NextResponse.json({
    reviewId,
    status: 'finalized',
    summary: { totalDecisions: rawDecisions.length, accepted, rejected },
    comment: commentResult,
    ...(prUrlParts
      ? {}
      : {
          warning:
            'prUrl could not be parsed — history metadata stored with placeholder values',
        }),
  })
}
