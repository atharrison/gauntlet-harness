/**
 * In-process review cache.
 *
 * Bridges the SSE route (where the review runs) and the finalize route
 * (where the user submits decisions). A module-level Map keyed by reviewId
 * survives across request boundaries within the same process instance, which
 * is fine for Railway's single-instance deploy and local dev.
 *
 * Entries are evicted after TTL_MS to prevent unbounded growth.
 */

import type { PRReview } from '../agents/pr-review/schema'

const TTL_MS = 60 * 60 * 1000 // 1 hour

interface CacheEntry {
  review: PRReview
  prUrl: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export function cacheReview(reviewId: string, prUrl: string, review: PRReview): void {
  cache.set(reviewId, { review, prUrl, expiresAt: Date.now() + TTL_MS })
  // Opportunistically evict expired entries on each write
  const now = Date.now()
  for (const [id, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt < now) cache.delete(id)
  }
}

export function getCachedReview(reviewId: string): CacheEntry | undefined {
  const entry = cache.get(reviewId)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    cache.delete(reviewId)
    return undefined
  }
  return entry
}
