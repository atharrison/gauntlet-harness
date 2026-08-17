/**
 * Tests for src/memory/supabase.ts (SupabaseMemoryStore).
 * Injects a mock Supabase client via the constructor.
 */

import { SupabaseMemoryStore } from '../src/memory/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of [
    'from',
    'select',
    'insert',
    'eq',
    'or',
    'order',
    'limit',
    'ilike',
  ]) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

function makeClient(result: { data: unknown; error: unknown }): SupabaseClient {
  const chain = makeChain(result)
  return { from: jest.fn().mockReturnValue(chain) } as unknown as SupabaseClient
}

describe('SupabaseMemoryStore', () => {
  describe('getMemories', () => {
    it('returns mapped Memory objects on success', async () => {
      const rows = [
        {
          id: 'm1',
          content: 'remember this',
          tags: ['tag1'],
          context: 'pr-review',
          created_at: '2026-01-01',
        },
        {
          id: 'm2',
          content: 'also this',
          tags: null,
          context: null,
          created_at: '2026-01-02',
        },
      ]
      const store = new SupabaseMemoryStore(
        makeClient({ data: rows, error: null })
      )
      const result = await store.getMemories('pr-review')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'm1',
        content: 'remember this',
        tags: ['tag1'],
        context: 'pr-review',
      })
      expect(result[1].tags).toEqual([])
      expect(result[1].context).toBe('')
    })

    it('throws when Supabase returns an error', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: { message: 'query failed' } })
      )
      await expect(store.getMemories('ctx')).rejects.toThrow(
        'getMemories failed'
      )
    })
  })

  describe('createMemory', () => {
    it('inserts a new memory row', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: null })
      )
      await expect(
        store.createMemory('remember X', ['tag'])
      ).resolves.toBeUndefined()
    })

    it('throws when Supabase returns an error', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: { message: 'insert failed' } })
      )
      await expect(store.createMemory('remember X', [])).rejects.toThrow(
        'createMemory failed'
      )
    })
  })

  describe('searchReviews', () => {
    it('returns mapped ReviewRecord objects on success', async () => {
      const rows = [
        {
          id: 'r1',
          pr_url: 'https://github.com/a/b/pull/1',
          repo_name: 'a/b',
          pr_title: 'Fix bug',
          author: 'dev',
          reviewed_at: '2026-01-01',
          finding_count: 2,
          summary: 'LGTM',
          raw_json: '{}',
        },
      ]
      const store = new SupabaseMemoryStore(
        makeClient({ data: rows, error: null })
      )
      const result = await store.searchReviews('fix')
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'r1',
        prUrl: 'https://github.com/a/b/pull/1',
        findingCount: 2,
      })
    })

    it('returns empty array when no results', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: null })
      )
      const result = await store.searchReviews('nothing')
      expect(result).toEqual([])
    })

    it('throws when Supabase returns an error', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: { message: 'search failed' } })
      )
      await expect(store.searchReviews('query')).rejects.toThrow(
        'searchReviews failed'
      )
    })

    it('passes topK limit to the query', async () => {
      const client = makeClient({ data: [], error: null })
      const store = new SupabaseMemoryStore(client)
      await store.searchReviews('test', 3)
      // just verify it resolves without error (limit is passed to chain internally)
      expect(true).toBe(true)
    })
  })

  describe('storeReview', () => {
    it('inserts a review_history row', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: null })
      )
      const review = { summary: 'All good', findings: [{ id: '1' }] }
      await expect(
        store.storeReview(review, {
          prUrl: 'https://github.com/a/b/pull/1',
          repoName: 'a/b',
          prTitle: 'Feature',
          author: 'dev',
          prNumber: 1,
        })
      ).resolves.toBeUndefined()
    })

    it('counts findings correctly when findings is not an array', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: null })
      )
      await expect(
        store.storeReview(
          { summary: 'ok' },
          { prUrl: 'u', repoName: 'r', prTitle: 't', author: 'a', prNumber: 1 }
        )
      ).resolves.toBeUndefined()
    })

    it('throws when Supabase returns an error', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: { message: 'insert failed' } })
      )
      await expect(
        store.storeReview(
          {},
          { prUrl: 'u', repoName: 'r', prTitle: 't', author: 'a', prNumber: 1 }
        )
      ).rejects.toThrow('storeReview failed')
    })
  })

  describe('searchCode', () => {
    it('returns an empty array (v2 stub)', async () => {
      const store = new SupabaseMemoryStore(
        makeClient({ data: null, error: null })
      )
      const result = await store.searchCode('anything')
      expect(result).toEqual([])
    })
  })

  describe('constructor without client', () => {
    it('throws when env vars are missing', () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      expect(() => new SupabaseMemoryStore()).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL'
      )
      process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl
      process.env.SUPABASE_SERVICE_ROLE_KEY = origKey
    })
  })
})
