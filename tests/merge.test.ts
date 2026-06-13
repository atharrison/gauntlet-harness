import { mergeResults, bucketFindings } from '../src/agents/pr-review/merge'
import type { DomainResult, Finding } from '../src/agents/pr-review/schema'

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? 'f-' + Math.random().toString(36).slice(2),
    severity: overrides.severity ?? 'SUGGESTION',
    category: overrides.category ?? 'CORRECTNESS',
    file: overrides.file ?? 'src/foo.ts',
    line: overrides.line,
    title: overrides.title ?? 'Test finding',
    body: overrides.body ?? 'Description',
    confidence: overrides.confidence ?? 0.8,
    suggestedFix: overrides.suggestedFix,
  }
}

function makeResult(
  domain: DomainResult['domain'],
  findings: Finding[]
): DomainResult {
  return { domain, findings, confidence: 0.8, tokensUsed: 100, durationMs: 500 }
}

describe('mergeResults', () => {
  it('returns empty array for no results', () => {
    expect(mergeResults([])).toEqual([])
  })

  it('returns findings unchanged when no duplicates', () => {
    const a = makeFinding({ file: 'src/a.ts', line: 10, title: 'Alpha issue' })
    const b = makeFinding({ file: 'src/b.ts', line: 20, title: 'Beta issue' })
    const results = mergeResults([makeResult('CORRECTNESS', [a, b])])
    expect(results).toHaveLength(2)
  })

  it('deduplicates findings on the same file within 3 lines with similar titles', () => {
    const a = makeFinding({
      id: 'a1',
      file: 'src/foo.ts',
      line: 10,
      title: 'Missing null check',
      confidence: 0.9,
      severity: 'BLOCKING',
    })
    const b = makeFinding({
      id: 'b1',
      file: 'src/foo.ts',
      line: 11,
      title: 'Missing null check here',
      confidence: 0.75,
      severity: 'SUGGESTION',
    })
    const results = mergeResults([
      makeResult('CORRECTNESS', [a]),
      makeResult('SECURITY', [b]),
    ])
    expect(results).toHaveLength(1)
    // The winner keeps the higher-confidence id and promotes to BLOCKING
    expect(results[0].severity).toBe('BLOCKING')
    expect(results[0].confidence).toBe(0.9)
  })

  it('does not dedup findings on different files', () => {
    const a = makeFinding({ file: 'src/a.ts', line: 10, title: 'Null check missing' })
    const b = makeFinding({ file: 'src/b.ts', line: 10, title: 'Null check missing' })
    expect(mergeResults([makeResult('CORRECTNESS', [a, b])])).toHaveLength(2)
  })

  it('does not dedup findings that are far apart on the same file', () => {
    const a = makeFinding({ file: 'src/a.ts', line: 10, title: 'Null check' })
    const b = makeFinding({ file: 'src/a.ts', line: 50, title: 'Null check issue' })
    expect(mergeResults([makeResult('CORRECTNESS', [a, b])])).toHaveLength(2)
  })

  it('applies confidence penalty (×0.9) to uncorroborated findings', () => {
    const a = makeFinding({ id: 'solo', confidence: 1.0, file: 'src/x.ts', line: 1, title: 'Unique' })
    const results = mergeResults([makeResult('CORRECTNESS', [a])])
    expect(results[0].confidence).toBeCloseTo(0.9)
  })

  it('sorts BLOCKING before SUGGESTION before NIT', () => {
    const nit = makeFinding({ file: 'src/nit.ts', title: 'Nit issue', severity: 'NIT', confidence: 1.0 })
    const blocking = makeFinding({ file: 'src/block.ts', title: 'Blocking issue', severity: 'BLOCKING', confidence: 0.7 })
    const suggestion = makeFinding({ file: 'src/suggest.ts', title: 'Suggestion issue', severity: 'SUGGESTION', confidence: 0.8 })
    const sorted = mergeResults([makeResult('CORRECTNESS', [nit, suggestion, blocking])])
    expect(sorted).toHaveLength(3)
    expect(sorted[0].severity).toBe('BLOCKING')
    expect(sorted[1].severity).toBe('SUGGESTION')
    expect(sorted[2].severity).toBe('NIT')
  })

  it('sorts by confidence desc within same severity', () => {
    const low = makeFinding({ file: 'src/a.ts', title: 'Low suggestion', severity: 'SUGGESTION', confidence: 0.7 })
    const high = makeFinding({ file: 'src/b.ts', title: 'High suggestion', severity: 'SUGGESTION', confidence: 0.95 })
    const sorted = mergeResults([makeResult('CORRECTNESS', [low, high])])
    expect(sorted).toHaveLength(2)
    expect(sorted[0].confidence).toBeGreaterThan(sorted[1].confidence)
  })
})

describe('bucketFindings', () => {
  it('splits findings into three buckets by severity', () => {
    const findings: Finding[] = [
      makeFinding({ severity: 'BLOCKING' }),
      makeFinding({ severity: 'SUGGESTION' }),
      makeFinding({ severity: 'NIT' }),
    ]
    const { blockingIssues, suggestions, nits } = bucketFindings(findings)
    expect(blockingIssues).toHaveLength(1)
    expect(suggestions).toHaveLength(1)
    expect(nits).toHaveLength(1)
  })
})
