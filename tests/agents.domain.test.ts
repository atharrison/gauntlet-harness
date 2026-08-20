/**
 * Unit tests for the three new single-shot domain agents:
 * Conventions, Performance, and Style.
 *
 * Each agent receives an EnrichedContext, calls model.chat once, and returns
 * a DomainResult. Tests verify: valid JSON → parsed correctly; malformed JSON
 * → graceful empty fallback; custom conventionsDoc injected for conventions agent.
 */
import { runConventionsAgent } from '../src/agents/pr-review/conventions-agent'
import { runPerformanceAgent } from '../src/agents/pr-review/performance-agent'
import { runStyleAgent } from '../src/agents/pr-review/style-agent'
import type { ModelClient, ModelReply } from '../src/harness/models'
import type { EnrichedContext } from '../src/agents/pr-review/schema'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ENRICHED_CONTEXT: EnrichedContext = {
  prUrl: 'https://github.com/owner/repo/pull/1',
  prTitle: 'Add user settings page',
  prAuthor: 'dev',
  prBranch: 'feature/settings',
  diff: '--- a/src/settings.ts\n+++ b/src/settings.ts\n@@ -1 +1 @@\n+export const FOO = "bar"',
  filesChanged: ['src/settings.ts'],
  fileCoverage: [{ file: 'src/settings.ts', status: 'READ' }],
  externalContextCalls: 0,
  ticketAcceptanceCriteria: [],
  pastReviewSummaries: [],
  memories: [],
}

function makeReply(text: string): ModelReply {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: 200, outputTokens: 80 },
    model: 'claude-test',
    cost: 0.001,
  }
}

function domainResultJson(domain: string, findings: unknown[] = []): string {
  return JSON.stringify({
    domain,
    findings,
    confidence: 0.85,
  })
}

function makeFinding(category: string) {
  return {
    id: 'test-uuid-1',
    severity: 'NIT',
    category,
    file: 'src/settings.ts',
    line: 1,
    title: 'Example finding',
    body: 'Detailed explanation.',
    confidence: 0.8,
  }
}

function makeModel(replyText: string): ModelClient {
  return { chat: jest.fn().mockResolvedValue(makeReply(replyText)) }
}

// ── Conventions Agent ─────────────────────────────────────────────────────────

describe('runConventionsAgent', () => {
  it('returns a valid DomainResult with CONVENTIONS domain on success', async () => {
    const model = makeModel(domainResultJson('CONVENTIONS'))
    const result = await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('CONVENTIONS')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0.85)
    expect(result.tokensUsed).toBe(280)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('stamps category on each finding', async () => {
    const model = makeModel(
      domainResultJson('CONVENTIONS', [makeFinding('CONVENTIONS')])
    )
    const result = await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].category).toBe('CONVENTIONS')
  })

  it('falls back to empty result on malformed JSON', async () => {
    const model = makeModel('sorry, I cannot review this PR')
    const result = await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('CONVENTIONS')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('strips markdown fences before parsing', async () => {
    const fenced = '```json\n' + domainResultJson('CONVENTIONS') + '\n```'
    const model = makeModel(fenced)
    const result = await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('CONVENTIONS')
    expect(result.findings).toEqual([])
  })

  it('injects conventionsDoc into the user prompt', async () => {
    const customDoc = 'Always use snake_case for database columns.'
    const model = makeModel(domainResultJson('CONVENTIONS'))
    await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
      conventionsDoc: customDoc,
    })

    const chatCall = (model.chat as jest.Mock).mock.calls[0]
    const userPromptContent = chatCall[0][0].content as string
    expect(userPromptContent).toContain(customDoc)
  })

  it('uses default conventions when conventionsDoc is absent', async () => {
    const model = makeModel(domainResultJson('CONVENTIONS'))
    await runConventionsAgent({ enrichedContext: ENRICHED_CONTEXT, model })

    const chatCall = (model.chat as jest.Mock).mock.calls[0]
    const systemPrompt = chatCall[2] as string
    expect(systemPrompt).toContain('UPPER_CASE')
  })

  it('uses custom conventions in system prompt when conventionsDoc is provided', async () => {
    const customDoc = 'Always use snake_case for database columns.'
    const model = makeModel(domainResultJson('CONVENTIONS'))
    await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
      conventionsDoc: customDoc,
    })

    const chatCall = (model.chat as jest.Mock).mock.calls[0]
    const systemPrompt = chatCall[2] as string
    expect(systemPrompt).toContain(customDoc)
  })

  it('replaces <uuid> placeholder IDs with real UUIDs', async () => {
    const finding = { ...makeFinding('CONVENTIONS'), id: '<uuid>' }
    const model = makeModel(domainResultJson('CONVENTIONS', [finding]))
    const result = await runConventionsAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings[0].id).not.toBe('<uuid>')
    expect(result.findings[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})

// ── Performance Agent ─────────────────────────────────────────────────────────

describe('runPerformanceAgent', () => {
  it('returns a valid DomainResult with PERFORMANCE domain on success', async () => {
    const model = makeModel(domainResultJson('PERFORMANCE'))
    const result = await runPerformanceAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('PERFORMANCE')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0.85)
    expect(result.tokensUsed).toBe(280)
  })

  it('stamps category on each finding', async () => {
    const model = makeModel(
      domainResultJson('PERFORMANCE', [makeFinding('PERFORMANCE')])
    )
    const result = await runPerformanceAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].category).toBe('PERFORMANCE')
  })

  it('falls back to empty result on malformed JSON', async () => {
    const model = makeModel('I found no performance issues in plain text')
    const result = await runPerformanceAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('PERFORMANCE')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('strips markdown fences before parsing', async () => {
    const fenced = '```json\n' + domainResultJson('PERFORMANCE') + '\n```'
    const model = makeModel(fenced)
    const result = await runPerformanceAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('PERFORMANCE')
    expect(result.findings).toEqual([])
  })

  it('replaces <uuid> placeholder IDs with real UUIDs', async () => {
    const finding = { ...makeFinding('PERFORMANCE'), id: '<uuid>' }
    const model = makeModel(domainResultJson('PERFORMANCE', [finding]))
    const result = await runPerformanceAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings[0].id).not.toBe('<uuid>')
    expect(result.findings[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  it('passes PERFORMANCE_SYSTEM as the system prompt', async () => {
    const model = makeModel(domainResultJson('PERFORMANCE'))
    await runPerformanceAgent({ enrichedContext: ENRICHED_CONTEXT, model })

    const chatCall = (model.chat as jest.Mock).mock.calls[0]
    const systemPrompt = chatCall[2] as string
    expect(systemPrompt).toContain('N+1')
  })
})

// ── Style Agent ───────────────────────────────────────────────────────────────

describe('runStyleAgent', () => {
  it('returns a valid DomainResult with STYLE domain on success', async () => {
    const model = makeModel(domainResultJson('STYLE'))
    const result = await runStyleAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('STYLE')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0.85)
    expect(result.tokensUsed).toBe(280)
  })

  it('stamps category on each finding', async () => {
    const model = makeModel(domainResultJson('STYLE', [makeFinding('STYLE')]))
    const result = await runStyleAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].category).toBe('STYLE')
  })

  it('falls back to empty result on malformed JSON', async () => {
    const model = makeModel('no style issues found here')
    const result = await runStyleAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('STYLE')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
  })

  it('strips markdown fences before parsing', async () => {
    const fenced = '```json\n' + domainResultJson('STYLE') + '\n```'
    const model = makeModel(fenced)
    const result = await runStyleAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.domain).toBe('STYLE')
    expect(result.findings).toEqual([])
  })

  it('replaces <uuid> placeholder IDs with real UUIDs', async () => {
    const finding = { ...makeFinding('STYLE'), id: '<uuid>' }
    const model = makeModel(domainResultJson('STYLE', [finding]))
    const result = await runStyleAgent({
      enrichedContext: ENRICHED_CONTEXT,
      model,
    })

    expect(result.findings[0].id).not.toBe('<uuid>')
    expect(result.findings[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  it('passes STYLE_SYSTEM as the system prompt', async () => {
    const model = makeModel(domainResultJson('STYLE'))
    await runStyleAgent({ enrichedContext: ENRICHED_CONTEXT, model })

    const chatCall = (model.chat as jest.Mock).mock.calls[0]
    const systemPrompt = chatCall[2] as string
    expect(systemPrompt).toContain('Dead code')
  })
})
