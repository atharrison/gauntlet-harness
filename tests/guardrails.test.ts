import {
  validateReviewOutput,
  checkPRSize,
  stripHallucinatedFindings,
} from '../src/harness/guardrails'
import type { EnrichedContext, PRReview } from '../src/agents/pr-review/schema'

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const baseContext: EnrichedContext = {
  prUrl: 'https://github.com/org/repo/pull/1',
  prTitle: 'Add feature',
  prAuthor: 'ath',
  prBranch: 'ath/feature',
  diff: 'diff --git a/src/foo.ts',
  filesChanged: ['src/foo.ts', 'src/bar.ts'],
  fileCoverage: [],
  externalContextCalls: 0,
}

const validReview: PRReview = {
  reviewId: 'rev-1',
  prUrl: 'https://github.com/org/repo/pull/1',
  summary: 'Looks good',
  fileCoverage: [],
  ticketAlignment: [],
  whatLooksGood: [],
  blockingIssues: [],
  suggestions: [],
  nits: [],
  questions: [],
  testingRecommendations: [],
  verdict: 'APPROVE',
  verdictSummary: 'Ship it',
  confidence: 0.9,
}

describe('validateReviewOutput', () => {
  it('passes a valid review against matching files', () => {
    const result = validateReviewOutput(validReview, baseContext, 'rev-1')
    expect(result.pass).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails schema validation for malformed output', () => {
    const result = validateReviewOutput(
      { summary: 'incomplete' },
      baseContext,
      'rev-1'
    )
    expect(result.pass).toBe(false)
    expect(result.errors[0]).toMatch(/Schema validation failed/)
  })

  it('detects hallucinated file citation and fires alarm', () => {
    const reviewWithBadFile: PRReview = {
      ...validReview,
      suggestions: [
        {
          id: 'f1',
          severity: 'SUGGESTION',
          category: 'STYLE',
          file: 'src/nonexistent.ts', // not in PR
          title: 'Fix naming',
          body: 'Rename this',
          confidence: 0.8,
        },
      ],
    }
    const result = validateReviewOutput(reviewWithBadFile, baseContext, 'rev-1')
    expect(result.pass).toBe(false)
    expect(
      result.errors.some(e => e.includes('Hallucinated file citation'))
    ).toBe(true)
  })

  it('detects secret patterns in review output', () => {
    const reviewWithSecret: PRReview = {
      ...validReview,
      summary: 'Found key: sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890',
    }
    const result = validateReviewOutput(reviewWithSecret, baseContext, 'rev-1')
    expect(result.pass).toBe(false)
    expect(result.errors.some(e => e.includes('Secret pattern detected'))).toBe(
      true
    )
  })
})

describe('checkPRSize', () => {
  it('passes for small PR', () => {
    const { oversized } = checkPRSize(['a.ts', 'b.ts'], 100)
    expect(oversized).toBe(false)
  })

  it('flags oversized PR', () => {
    const files = Array.from({ length: 60 }, (_, i) => `file${i}.ts`)
    const { oversized, alarm } = checkPRSize(files, 200)
    expect(oversized).toBe(true)
    expect(alarm?.alarmType).toBe('PR_TOO_LARGE')
  })
})

describe('stripHallucinatedFindings', () => {
  it('removes findings referencing files not in PR', () => {
    const review: PRReview = {
      ...validReview,
      nits: [
        {
          id: 'n1',
          severity: 'NIT',
          category: 'STYLE',
          file: 'src/foo.ts',
          title: 'x',
          body: 'y',
          confidence: 0.5,
        },
        {
          id: 'n2',
          severity: 'NIT',
          category: 'STYLE',
          file: 'src/ghost.ts',
          title: 'x',
          body: 'y',
          confidence: 0.5,
        },
      ],
    }
    const cleaned = stripHallucinatedFindings(review, baseContext)
    expect(cleaned.nits).toHaveLength(1)
    expect(cleaned.nits[0].file).toBe('src/foo.ts')
  })
})
