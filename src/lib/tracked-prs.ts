/**
 * Tracked-PR status enum and payload builders for the review-lifecycle
 * sync (ATH-15). Pure — no I/O.
 *
 * `review_count` is incremented by the `tracked_prs_on_reviewed` DB trigger
 * when status transitions to REVIEWED. Do not increment it in application code.
 */

import type { ParsedPrUrl } from './queue'

export enum TrackedPrStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  REVIEWED = 'REVIEWED',
  CLOSED = 'CLOSED',
}

export interface TrackedPrInReviewUpsert {
  owner: string
  repo: string
  pr_number: number
  pr_url: string
  status: TrackedPrStatus.IN_REVIEW
  last_review_id?: string
}

export interface TrackedPrReviewedPatch {
  status: TrackedPrStatus.REVIEWED
  last_review_id: string
}

/** Payload for upserting a queue row when a review starts.
 *
 * Always IN_REVIEW — including when the existing row is CLOSED. Starting a
 * review is an explicit user action and records that intent on the queue.
 */
export function buildInReviewUpsert(
  parsed: ParsedPrUrl,
  reviewId: string | null
): TrackedPrInReviewUpsert {
  const row: TrackedPrInReviewUpsert = {
    owner: parsed.owner,
    repo: parsed.repo,
    pr_number: parsed.pr_number,
    pr_url: parsed.canonical_url,
    status: TrackedPrStatus.IN_REVIEW,
  }
  if (reviewId) row.last_review_id = reviewId
  return row
}

/** Payload for flipping a queue row to REVIEWED on finalize. */
export function buildReviewedPatch(reviewId: string): TrackedPrReviewedPatch {
  return {
    status: TrackedPrStatus.REVIEWED,
    last_review_id: reviewId,
  }
}
