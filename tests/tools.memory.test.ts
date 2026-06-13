import { createMemoryTools } from '../src/tools/memory'
import type { MemoryStore } from '../src/memory/store'

function mockStore(): jest.Mocked<MemoryStore> {
  return {
    searchReviews: jest.fn().mockResolvedValue([]),
    getMemories: jest.fn().mockResolvedValue([]),
    storeReview: jest.fn().mockResolvedValue(undefined),
    createMemory: jest.fn().mockResolvedValue(undefined),
    searchCode: jest.fn().mockResolvedValue([]),
  }
}

describe('createMemoryTools', () => {
  it('registers the expected 3 tools', () => {
    const tools = createMemoryTools(mockStore())
    expect(Object.keys(tools).sort()).toEqual([
      'create_memory',
      'search_past_reviews',
      'store_review',
    ])
  })

  describe('search_past_reviews', () => {
    it('calls store.searchReviews and returns mapped results', async () => {
      const store = mockStore()
      store.searchReviews.mockResolvedValue([
        {
          id: 'r1',
          prUrl: 'https://github.com/org/repo/pull/1',
          repoName: 'org/repo',
          prTitle: 'Add auth',
          author: 'alice',
          reviewedAt: '2026-06-13T00:00:00Z',
          findingCount: 3,
          summary: 'Found 3 issues',
          rawJson: {},
        },
      ])
      const tools = createMemoryTools(store)
      const result = await tools.search_past_reviews.fn({ query: 'auth', topK: 5 })
      expect(store.searchReviews).toHaveBeenCalledWith('auth', 5)
      const reviews = result as Array<{ prTitle: string }>
      expect(reviews[0].prTitle).toBe('Add auth')
    })
  })

  describe('store_review', () => {
    it('calls store.storeReview with correct metadata', async () => {
      const store = mockStore()
      const tools = createMemoryTools(store)
      const result = await tools.store_review.fn({
        prUrl: 'https://github.com/org/repo/pull/1',
        repoName: 'org/repo',
        prTitle: 'Add auth',
        author: 'alice',
        prNumber: 1,
        review: { findings: [] },
      })
      expect(store.storeReview).toHaveBeenCalledWith(
        { findings: [] },
        expect.objectContaining({ prUrl: 'https://github.com/org/repo/pull/1', prNumber: 1 })
      )
      expect((result as { stored: boolean }).stored).toBe(true)
    })
  })

  describe('create_memory', () => {
    it('calls store.createMemory and returns confirmation', async () => {
      const store = mockStore()
      const tools = createMemoryTools(store)
      const result = await tools.create_memory.fn({
        content: 'Always use type hints',
        tags: ['python', 'style'],
      })
      expect(store.createMemory).toHaveBeenCalledWith('Always use type hints', ['python', 'style'])
      expect((result as { created: boolean }).created).toBe(true)
    })
  })
})
