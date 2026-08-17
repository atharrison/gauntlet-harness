/**
 * Tests for src/memory/review-store.ts
 * Mocks @supabase/supabase-js so no real DB is needed.
 */

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

// Set env vars before the module is imported
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

import { createClient } from '@supabase/supabase-js'
import {
  createReview,
  completeReview,
  failReview,
  getReview,
  setReviewSubmission,
} from '../src/memory/review-store'
import type { PRReview } from '../src/agents/pr-review/schema'

const mockCreateClient = createClient as jest.Mock

// Build a chainable Supabase query mock. `result` is what the final await resolves to.
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'insert', 'update', 'select', 'eq', 'order']) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  chain.single = jest.fn().mockResolvedValue(result)
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createReview', () => {
  it('inserts a RUNNING review row', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    await expect(
      createReview('rev-1', 'https://github.com/a/b/pull/1', 'full')
    ).resolves.toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { message: 'insert failed' } })
    )
    await expect(
      createReview('rev-1', 'https://github.com/a/b/pull/1', 'full')
    ).rejects.toThrow('createReview failed')
  })
})

describe('completeReview', () => {
  const fakeReview = {
    summary: 'LGTM',
    blockingIssues: [],
  } as unknown as PRReview

  it('updates the row to COMPLETE', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    await expect(completeReview('rev-1', fakeReview)).resolves.toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { message: 'update failed' } })
    )
    await expect(completeReview('rev-1', fakeReview)).rejects.toThrow(
      'completeReview failed'
    )
  })
})

describe('failReview', () => {
  it('updates the row to ERROR', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    await expect(
      failReview('rev-1', 'something went wrong')
    ).resolves.toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { message: 'update failed' } })
    )
    await expect(failReview('rev-1', 'something went wrong')).rejects.toThrow(
      'failReview failed'
    )
  })
})

describe('getReview', () => {
  it('returns the review row on success', async () => {
    const fakeRow = {
      id: 'rev-1',
      status: 'COMPLETE',
      pr_url: 'https://github.com/a/b/pull/1',
    }
    mockCreateClient.mockReturnValue(makeChain({ data: fakeRow, error: null }))
    const result = await getReview('rev-1')
    expect(result).toEqual(fakeRow)
  })

  it('returns null for PGRST116 (row not found)', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    )
    const result = await getReview('nonexistent')
    expect(result).toBeNull()
  })

  it('throws for other Supabase errors', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { code: '500', message: 'DB error' } })
    )
    await expect(getReview('rev-1')).rejects.toThrow('getReview failed')
  })
})

describe('setReviewSubmission', () => {
  it('updates the submission field', async () => {
    mockCreateClient.mockReturnValue(makeChain({ data: null, error: null }))
    await expect(
      setReviewSubmission('rev-1', { decision: 'accept' })
    ).resolves.toBeUndefined()
  })

  it('throws when Supabase returns an error', async () => {
    mockCreateClient.mockReturnValue(
      makeChain({ data: null, error: { message: 'update failed' } })
    )
    await expect(setReviewSubmission('rev-1', {})).rejects.toThrow(
      'setReviewSubmission failed'
    )
  })
})
