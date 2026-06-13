import { z } from 'zod'
import type { ToolEntry } from '../harness/tools'
import type { MemoryStore, PRMetadata } from '../memory/store'

// ── Schemas ───────────────────────────────────────────────────────────────────

const SearchPastReviewsSchema = z.object({
  query: z.string(),
  topK: z.number().optional(),
})

const StoreReviewSchema = z.object({
  prUrl: z.string(),
  repoName: z.string(),
  prTitle: z.string(),
  author: z.string(),
  prNumber: z.number(),
  review: z.unknown(),
})

const CreateMemorySchema = z.object({
  content: z.string(),
  tags: z.array(z.string()),
})

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createMemoryTools(
  store: MemoryStore
): Record<string, ToolEntry> {
  return {
    search_past_reviews: {
      description:
        'Search review history for past reviews matching a query. Returns summaries of previous reviews, useful for context on recurring patterns.',
      schema: SearchPastReviewsSchema,
      fn: async ({ query, topK }) => {
        const results = await store.searchReviews(query, topK)
        return results.map(r => ({
          id: r.id,
          prUrl: r.prUrl,
          prTitle: r.prTitle,
          author: r.author,
          reviewedAt: r.reviewedAt,
          findingCount: r.findingCount,
          summary: r.summary,
        }))
      },
    },

    store_review: {
      description:
        'Persist the completed review to memory for future reference. Call this after the approval loop completes.',
      schema: StoreReviewSchema,
      fn: async ({ prUrl, repoName, prTitle, author, prNumber, review }) => {
        const metadata: PRMetadata = {
          prUrl,
          repoName,
          prTitle,
          author,
          prNumber,
        }
        await store.storeReview(review, metadata)
        return { stored: true, prUrl }
      },
    },

    create_memory: {
      description:
        'Create a persistent memory (team coding standard, review criterion, or pattern). Memories are injected into future reviews as context.',
      schema: CreateMemorySchema,
      fn: async ({ content, tags }) => {
        await store.createMemory(content, tags)
        return { created: true, content, tags }
      },
    },
  }
}
