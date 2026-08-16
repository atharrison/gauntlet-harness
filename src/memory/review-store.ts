/**
 * Supabase-backed review store.
 *
 * Replaces the in-process review-cache.ts Map. Reviews are persisted to the
 * `reviews` table so they survive Railway restarts and work across replicas.
 *
 * All functions use the service-role key (server-side only).
 */

import { createClient } from '@supabase/supabase-js'
import type { PRReview } from '../agents/pr-review/schema'

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the review store'
    )
  }
  return createClient(url, key)
}

export type ReviewStatus = 'RUNNING' | 'COMPLETE' | 'ERROR'

export interface ReviewRow {
  id: string
  pr_url: string
  pr_metadata: Record<string, unknown>
  mode: 'full' | 'quick'
  status: ReviewStatus
  result: PRReview | null
  submission: unknown | null
  error_message: string | null
  created_at: string
  updated_at: string
}

/** Insert a new RUNNING review row when a review starts. */
export async function createReview(
  id: string,
  prUrl: string,
  mode: 'full' | 'quick'
): Promise<void> {
  const { error } = await createSupabaseClient().from('reviews').insert({
    id,
    pr_url: prUrl,
    mode,
    status: 'RUNNING',
  })
  if (error) throw new Error(`createReview failed: ${error.message}`)
}

/** Update the row to COMPLETE and store the full PRReview result. */
export async function completeReview(
  id: string,
  review: PRReview
): Promise<void> {
  const { error } = await createSupabaseClient()
    .from('reviews')
    .update({
      status: 'COMPLETE',
      result: review as unknown as Record<string, unknown>,
    })
    .eq('id', id)
  if (error) throw new Error(`completeReview failed: ${error.message}`)
}

/** Update the row to ERROR with a message. */
export async function failReview(
  id: string,
  errorMessage: string
): Promise<void> {
  const { error } = await createSupabaseClient()
    .from('reviews')
    .update({ status: 'ERROR', error_message: errorMessage })
    .eq('id', id)
  if (error) throw new Error(`failReview failed: ${error.message}`)
}

/** Fetch a review row by ID. Returns null if not found. */
export async function getReview(id: string): Promise<ReviewRow | null> {
  const { data, error } = await createSupabaseClient()
    .from('reviews')
    .select('*')
    .eq('id', id)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    throw new Error(`getReview failed: ${error.message}`)
  }
  return data as ReviewRow
}

/** Persist the user's finalize submission against the review row. */
export async function setReviewSubmission(
  id: string,
  submission: unknown
): Promise<void> {
  const { error } = await createSupabaseClient()
    .from('reviews')
    .update({ submission: submission as Record<string, unknown> })
    .eq('id', id)
  if (error) throw new Error(`setReviewSubmission failed: ${error.message}`)
}
