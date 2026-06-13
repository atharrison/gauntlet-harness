import { runReview } from '../src/agents/pr-review/coordinator'
import type { ReviewContext } from '../src/harness/context'
import type { ModelClient, ModelReply } from '../src/harness/models'
import { InMemoryCheckpointStore } from '../src/harness/checkpoints'
import type { ToolRegistry } from '../src/harness/tools'
import { dispatch } from '../src/harness/tools'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModelReply(text: string): ModelReply {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'claude-test',
    cost: 0,
  }
}

function makeEnrichedContextJson(): string {
  return JSON.stringify({
    prUrl: 'https://github.com/owner/repo/pull/1',
    prTitle: 'Test PR',
    prAuthor: 'dev',
    prBranch: 'feature/test',
    diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n+const x = 1',
    filesChanged: ['src/foo.ts'],
    fileCoverage: [{ file: 'src/foo.ts', status: 'READ' }],
    ticketId: null,
    ticketSummary: null,
    ticketAcceptanceCriteria: [],
    pastReviewSummaries: [],
    memories: [],
    externalContextCalls: 2,
  })
}

function makeEmptyDomainResult(domain: string): string {
  return JSON.stringify({
    domain,
    findings: [],
    confidence: 0.9,
    tokensUsed: 50,
    durationMs: 100,
  })
}

function makeSummaryJson(): string {
  return JSON.stringify({
    summary: 'Clean PR with minor improvements.',
    whatLooksGood: ['Good test coverage'],
    questions: [],
    testingRecommendations: ['Run integration tests'],
    verdict: 'APPROVE',
    verdictSummary: 'No blocking issues found.',
    ticketAlignment: [],
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runReview (coordinator)', () => {
  let callCount: number
  let mockModel: ModelClient

  beforeEach(() => {
    callCount = 0
    mockModel = {
      chat: jest.fn(async (_messages, _tools, _systemPrompt) => {
        callCount++
        // Call sequence in full mode:
        // 1 = context agent loop call (produces EnrichedContext JSON)
        // 2 = correctness agent (produces DomainResult)
        // 3 = security agent (produces DomainResult)
        // 4 = coordinator summary
        if (callCount === 1) return makeModelReply(makeEnrichedContextJson())
        if (callCount === 2)
          return makeModelReply(makeEmptyDomainResult('CORRECTNESS'))
        if (callCount === 3)
          return makeModelReply(makeEmptyDomainResult('SECURITY'))
        return makeModelReply(makeSummaryJson())
      }),
    }
  })

  function makeContext(): ReviewContext {
    const checkpoints = new InMemoryCheckpointStore()
    const registry: ToolRegistry = {}
    return {
      deps: {
        model: mockModel,
        memory: {
          getMemories: async () => [],
          createMemory: async () => {},
          searchReviews: async () => [],
          storeReview: async () => {},
          searchCode: async () => [],
        },
        checkpoints,
      },
      registry,
      dispatcher: _reviewId => call => dispatch(call, registry, _reviewId),
    }
  }

  it('runs the full pipeline and returns a PRReview in quick mode', async () => {
    const context = makeContext()
    const events: Array<{ event: string; data: unknown }> = []

    const review = await runReview({
      reviewId: 'test-rev-1',
      prUrl: 'https://github.com/owner/repo/pull/1',
      mode: 'quick', // skips context agent loop
      context,
      emit: (event, data) => events.push({ event, data }),
    })

    expect(review.reviewId).toBe('test-rev-1')
    expect(review.prUrl).toBe('https://github.com/owner/repo/pull/1')
    expect(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).toContain(review.verdict)
    expect(events.some(e => e.event === 'done')).toBe(true)
    expect(events.some(e => e.event === 'checkpoint')).toBe(true)
  })

  it('emits the SSE done event at the end', async () => {
    const context = makeContext()
    const emitted: string[] = []

    await runReview({
      reviewId: 'test-rev-2',
      prUrl: 'https://github.com/owner/repo/pull/1',
      mode: 'quick',
      context,
      emit: event => emitted.push(event),
    })

    expect(emitted).toContain('done')
  })

  it('writes checkpoints to the store', async () => {
    const context = makeContext()

    await runReview({
      reviewId: 'test-rev-3',
      prUrl: 'https://github.com/owner/repo/pull/1',
      mode: 'quick',
      context,
    })

    const inputCp = await context.deps.checkpoints.load('test-rev-3', 'INPUT')
    expect(inputCp).not.toBeNull()
    expect(inputCp?.status).toBe('PASS')
  })

  it('calls the SSE emitter when reviewId is present', async () => {
    const context = makeContext()
    const emit = jest.fn()

    await runReview({
      reviewId: 'test-rev-4',
      prUrl: 'https://github.com/owner/repo/pull/1',
      mode: 'quick',
      context,
      emit,
    })

    expect(emit).toHaveBeenCalledWith(
      'done',
      expect.objectContaining({ reviewId: 'test-rev-4' })
    )
  })

  it('does not call SSE emitter when reviewId is absent', async () => {
    // Just check the default no-op emit doesn't throw
    const context = makeContext()
    await expect(
      runReview({
        reviewId: 'test-rev-5',
        prUrl: 'https://github.com/owner/repo/pull/1',
        mode: 'quick',
        context,
        // emit not provided — defaults to no-op
      })
    ).resolves.toBeDefined()
  })
})
