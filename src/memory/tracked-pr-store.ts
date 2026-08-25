/**
 * Service-role writes that keep `tracked_prs` in sync with the review lifecycle.
 *
 * `review_count` is incremented by the `tracked_prs_on_reviewed` trigger —
 * these helpers never write that column.
 */

import { createSupabaseServiceRoleClient } from '../lib/supabase/server'
import type { ParsedPrUrl } from '../lib/queue'
import { buildInReviewUpsert, buildReviewedPatch } from '../lib/tracked-prs'

/** Upsert the queue row to IN_REVIEW and record last_review_id.
 *
 * No prior-status guard: a user-triggered start is a re-review, including
 * CLOSED → IN_REVIEW. REVIEWED → IN_REVIEW is the ATH-15 acceptance path.
 */
export async function markPrInReview(
  parsed: ParsedPrUrl,
  reviewId: string | null
): Promise<void> {
  const { error } = await createSupabaseServiceRoleClient()
    .from('tracked_prs')
    .upsert(buildInReviewUpsert(parsed, reviewId), {
      onConflict: 'owner,repo,pr_number',
    })
  if (error) throw new Error(`markPrInReview failed: ${error.message}`)
}

/** Flip an existing queue row to REVIEWED. No-op if the row does not exist. */
export async function markPrReviewed(
  parsed: ParsedPrUrl,
  reviewId: string
): Promise<void> {
  const { error } = await createSupabaseServiceRoleClient()
    .from('tracked_prs')
    .update(buildReviewedPatch(reviewId))
    .eq('owner', parsed.owner)
    .eq('repo', parsed.repo)
    .eq('pr_number', parsed.pr_number)
  if (error) throw new Error(`markPrReviewed failed: ${error.message}`)
}
