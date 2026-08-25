/**
 * Tests for src/memory/tracked-pr-store.ts
 */

const mockFrom = jest.fn()

jest.mock('../src/lib/supabase/server', () => ({
  createSupabaseServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
}))

import { parsePrUrl } from '../src/lib/queue'
import { TrackedPrStatus } from '../src/lib/tracked-prs'
import { markPrInReview, markPrReviewed } from '../src/memory/tracked-pr-store'

const parsed = parsePrUrl('https://github.com/acme/app/pull/7')!

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of ['upsert', 'update', 'eq']) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('markPrInReview', () => {
  it('upserts IN_REVIEW + last_review_id on the owner/repo/pr_number conflict', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)
    await markPrInReview(parsed, 'rev-1')
    expect(mockFrom).toHaveBeenCalledWith('tracked_prs')
    expect(chain.upsert).toHaveBeenCalledWith(
      {
        owner: 'acme',
        repo: 'app',
        pr_number: 7,
        pr_url: 'https://github.com/acme/app/pull/7',
        status: TrackedPrStatus.IN_REVIEW,
        last_review_id: 'rev-1',
      },
      { onConflict: 'owner,repo,pr_number' }
    )
  })

  it('throws when Supabase returns an error', async () => {
    mockFrom.mockReturnValue(
      makeChain({ data: null, error: { message: 'fk violation' } })
    )
    await expect(markPrInReview(parsed, 'rev-1')).rejects.toThrow(
      'markPrInReview failed: fk violation'
    )
  })

  it('omits last_review_id when reviewId is null', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)
    await markPrInReview(parsed, null)
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ last_review_id: expect.anything() }),
      { onConflict: 'owner,repo,pr_number' }
    )
  })
})

describe('markPrReviewed', () => {
  it('updates REVIEWED + last_review_id without incrementing review_count', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)
    await markPrReviewed(parsed, 'rev-2')
    expect(chain.update).toHaveBeenCalledWith({
      status: TrackedPrStatus.REVIEWED,
      last_review_id: 'rev-2',
    })
    expect(chain.eq).toHaveBeenCalledWith('owner', 'acme')
    expect(chain.eq).toHaveBeenCalledWith('repo', 'app')
    expect(chain.eq).toHaveBeenCalledWith('pr_number', 7)
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('review_count')
  })

  it('throws when Supabase returns an error', async () => {
    mockFrom.mockReturnValue(
      makeChain({ data: null, error: { message: 'timeout' } })
    )
    await expect(markPrReviewed(parsed, 'rev-2')).rejects.toThrow(
      'markPrReviewed failed: timeout'
    )
  })
})
