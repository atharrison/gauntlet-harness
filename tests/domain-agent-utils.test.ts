/**
 * Unit tests for the shared parseDomainResult utility.
 *
 * All five domain agents delegate to this function, so correctness here
 * covers conventions, correctness, performance, security, and style agents.
 */
import { parseDomainResult } from '../src/agents/pr-review/domain-agent-utils'

function validResultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    domain: 'CORRECTNESS',
    findings: [],
    confidence: 0.8,
    ...overrides,
  })
}

describe('parseDomainResult', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('parses a clean JSON response into a DomainResult', () => {
    const result = parseDomainResult(
      validResultJson(),
      'CORRECTNESS',
      100,
      300,
      0.01
    )

    expect(result.domain).toBe('CORRECTNESS')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0.8)
    expect(result.tokensUsed).toBe(300)
    expect(result.cost).toBe(0.01)
    expect(result.durationMs).toBe(100)
  })

  it('overrides domain from JSON with the explicitly supplied domain', () => {
    const result = parseDomainResult(
      JSON.stringify({ domain: 'CORRECTNESS', findings: [], confidence: 0.9 }),
      'SECURITY',
      50,
      200,
      0
    )
    expect(result.domain).toBe('SECURITY')
  })

  it('strips leading markdown code fence before parsing', () => {
    const fenced = '```json\n' + validResultJson() + '\n```'
    const result = parseDomainResult(fenced, 'CORRECTNESS', 100, 100, 0)
    expect(result.domain).toBe('CORRECTNESS')
    expect(result.findings).toEqual([])
  })

  it('strips plain ``` fence without language tag', () => {
    const fenced = '```\n' + validResultJson() + '\n```'
    const result = parseDomainResult(fenced, 'CORRECTNESS', 100, 100, 0)
    expect(result.domain).toBe('CORRECTNESS')
  })

  it('stamps category on each finding from the domain parameter', () => {
    const json = JSON.stringify({
      domain: 'STYLE',
      findings: [
        {
          id: 'abc-123',
          severity: 'NIT',
          category: 'STYLE',
          file: 'src/foo.ts',
          title: 'Dead code',
          body: 'Remove it.',
          confidence: 0.9,
        },
      ],
      confidence: 0.8,
    })
    const result = parseDomainResult(json, 'STYLE', 100, 100, 0)
    expect(result.findings[0].category).toBe('STYLE')
  })

  it('replaces <uuid> placeholder id with a real UUID', () => {
    const json = JSON.stringify({
      domain: 'PERFORMANCE',
      findings: [
        {
          id: '<uuid>',
          severity: 'SUGGESTION',
          category: 'PERFORMANCE',
          file: 'src/foo.ts',
          title: 'N+1',
          body: 'Batch it.',
          confidence: 0.85,
        },
      ],
      confidence: 0.85,
    })
    const result = parseDomainResult(json, 'PERFORMANCE', 100, 100, 0)
    expect(result.findings[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })

  it('preserves a real UUID id unchanged', () => {
    const realId = '11111111-2222-3333-4444-555555555555'
    const json = JSON.stringify({
      domain: 'CONVENTIONS',
      findings: [
        {
          id: realId,
          severity: 'NIT',
          category: 'CONVENTIONS',
          file: 'src/foo.ts',
          title: 'Naming',
          body: 'Fix it.',
          confidence: 0.8,
        },
      ],
      confidence: 0.8,
    })
    const result = parseDomainResult(json, 'CONVENTIONS', 100, 100, 0)
    expect(result.findings[0].id).toBe(realId)
  })

  // ── JSON parse failure ──────────────────────────────────────────────────────

  it('returns empty-findings sentinel when text is not JSON', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = parseDomainResult(
      'Sorry, no issues found.',
      'CORRECTNESS',
      100,
      100,
      0
    )

    expect(result.domain).toBe('CORRECTNESS')
    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse DomainResult JSON')
    )
    warnSpy.mockRestore()
  })

  it('returns empty-findings sentinel when JSON is valid but contains no object', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = parseDomainResult('[1, 2, 3]', 'SECURITY', 100, 100, 0)

    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
    warnSpy.mockRestore()
  })

  // ── Zod validation failure (the previously silent bug) ─────────────────────

  it('warns with Zod issues when JSON parses but fails schema validation', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Valid JSON, but confidence is a string — Zod should reject it
    const badJson = JSON.stringify({
      domain: 'CORRECTNESS',
      findings: [],
      confidence: 'high', // wrong type
    })
    const result = parseDomainResult(badJson, 'CORRECTNESS', 100, 100, 0)

    expect(result.findings).toEqual([])
    expect(result.confidence).toBe(0)
    // Must warn about Zod validation, not just a generic parse failure
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Zod validation failed')
    )
    warnSpy.mockRestore()
  })

  it('warns about Zod failure separately from JSON parse failure', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const badSchemaJson = JSON.stringify({
      domain: 'CORRECTNESS',
      findings: [{ id: 'x', severity: 'INVALID_SEVERITY' }], // bad enum
      confidence: 0.8,
    })
    parseDomainResult(badSchemaJson, 'CORRECTNESS', 100, 100, 0)

    const calls = warnSpy.mock.calls.map(c => c[0] as string)
    expect(calls.some(m => m.includes('Zod validation failed'))).toBe(true)
    // Should NOT also fire the generic "Failed to parse" warn for this case
    expect(
      calls.some(m => m.includes('Failed to parse DomainResult JSON'))
    ).toBe(false)
    warnSpy.mockRestore()
  })

  // ── DEBUG_LLM output ────────────────────────────────────────────────────────

  it('appends raw output to warn when DEBUG_LLM=true and JSON fails', () => {
    const orig = process.env.DEBUG_LLM
    process.env.DEBUG_LLM = 'true'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    parseDomainResult('not json at all', 'STYLE', 100, 100, 0)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not json at all')
    )
    warnSpy.mockRestore()
    process.env.DEBUG_LLM = orig
  })

  it('appends Zod issues to warn when DEBUG_LLM=true and schema validation fails', () => {
    const orig = process.env.DEBUG_LLM
    process.env.DEBUG_LLM = 'true'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    parseDomainResult(
      JSON.stringify({ domain: 'STYLE', findings: [], confidence: 'bad' }),
      'STYLE',
      100,
      100,
      0
    )

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Issues:'))
    warnSpy.mockRestore()
    process.env.DEBUG_LLM = orig
  })

  it('does not append raw output when DEBUG_LLM is not set', () => {
    const orig = process.env.DEBUG_LLM
    delete process.env.DEBUG_LLM
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    parseDomainResult('not json', 'CONVENTIONS', 100, 100, 0)

    expect(warnSpy).toHaveBeenCalledWith(
      '[conventions-agent] Failed to parse DomainResult JSON.'
    )
    warnSpy.mockRestore()
    process.env.DEBUG_LLM = orig
  })
})
