import {
  buildInitialDecisions,
  buildInitialState,
  toggleDecision,
  editFinding,
  buildSubmission,
  summariseDecisions,
  formatGitHubComment,
} from '../src/agents/pr-review/approval'
import type { PRReview, Finding } from '../src/agents/pr-review/schema'

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? 'f-' + Math.random().toString(36).slice(2),
    severity: overrides.severity ?? 'SUGGESTION',
    category: overrides.category ?? 'CORRECTNESS',
    file: overrides.file ?? 'src/foo.ts',
    title: overrides.title ?? 'Test finding',
    body: overrides.body ?? 'Description',
    confidence: overrides.confidence ?? 0.8,
    line: overrides.line,
  }
}

const blocking = makeFinding({ id: 'b1', severity: 'BLOCKING' })
const suggestion = makeFinding({ id: 's1', severity: 'SUGGESTION' })
const nit = makeFinding({ id: 'n1', severity: 'NIT' })

const review: PRReview = {
  reviewId: 'rev-1',
  prUrl: 'https://github.com/owner/repo/pull/1',
  summary: 'Good PR',
  fileCoverage: [],
  ticketAlignment: [],
  whatLooksGood: ['Clean code'],
  blockingIssues: [blocking],
  suggestions: [suggestion],
  nits: [nit],
  questions: [],
  testingRecommendations: ['Run unit tests'],
  verdict: 'REQUEST_CHANGES',
  verdictSummary: 'Fix the blocking issue before merging.',
  confidence: 0.85,
}

describe('buildInitialDecisions', () => {
  it('defaults BLOCKINGs and SUGGESTIONs to ACCEPT', () => {
    const decisions = buildInitialDecisions(review)
    expect(decisions['b1'].action).toBe('ACCEPT')
    expect(decisions['s1'].action).toBe('ACCEPT')
  })

  it('defaults NITs to REJECT', () => {
    const decisions = buildInitialDecisions(review)
    expect(decisions['n1'].action).toBe('REJECT')
  })
})

describe('toggleDecision', () => {
  it('toggles ACCEPT → REJECT', () => {
    const state = buildInitialState(review)
    const next = toggleDecision(state, 'b1')
    expect(next.decisions['b1'].action).toBe('REJECT')
  })

  it('toggles REJECT → ACCEPT', () => {
    const state = buildInitialState(review)
    const after = toggleDecision(state, 'n1') // NIT starts REJECT
    expect(after.decisions['n1'].action).toBe('ACCEPT')
  })

  it('toggles EDIT → REJECT (does not promote back to ACCEPT)', () => {
    let state = buildInitialState(review)
    state = editFinding(state, 'b1', 'my fix')       // ACCEPT → EDIT
    const after = toggleDecision(state, 'b1')         // EDIT → REJECT
    expect(after.decisions['b1'].action).toBe('REJECT')
  })

  it('returns state unchanged for unknown findingId', () => {
    const state = buildInitialState(review)
    const next = toggleDecision(state, 'nonexistent')
    expect(next).toEqual(state)
  })
})

describe('editFinding', () => {
  it('sets action to EDIT and stores editedBody', () => {
    const state = buildInitialState(review)
    const next = editFinding(state, 'b1', 'My custom fix text')
    expect(next.decisions['b1'].action).toBe('EDIT')
    expect(next.decisions['b1'].editedBody).toBe('My custom fix text')
  })
})

describe('buildSubmission', () => {
  it('includes all decisions in the submission', () => {
    const state = buildInitialState(review)
    const sub = buildSubmission(state, false)
    expect(sub.reviewId).toBe('rev-1')
    expect(sub.decisions).toHaveLength(3)
    expect(sub.postToGitHub).toBe(false)
  })

  it('sets postToGitHub=true when requested', () => {
    const state = buildInitialState(review)
    expect(buildSubmission(state, true).postToGitHub).toBe(true)
  })
})

describe('summariseDecisions', () => {
  it('counts accepted blocking findings', () => {
    const state = buildInitialState(review)
    const summary = summariseDecisions(review, state)
    expect(summary.blockingAccepted).toBe(1)
    expect(summary.accepted).toBe(2) // blocking + suggestion (nit is REJECT)
    expect(summary.rejected).toBe(1)
  })

  it('counts edited decisions as accepted', () => {
    let state = buildInitialState(review)
    state = editFinding(state, 's1', 'edited')
    const summary = summariseDecisions(review, state)
    expect(summary.edited).toBe(1)
    expect(summary.accepted).toBe(2) // blocking accepted + suggestion edited
  })
})

describe('formatGitHubComment', () => {
  it('includes verdict and summary in the output', () => {
    const state = buildInitialState(review)
    const sub = buildSubmission(state, true)
    const comment = formatGitHubComment(review, sub)
    expect(comment).toContain('REQUEST_CHANGES')
    expect(comment).toContain('Fix the blocking issue')
    expect(comment).toContain('Good PR')
  })

  it('includes accepted blocking findings', () => {
    const state = buildInitialState(review)
    const sub = buildSubmission(state, true)
    const comment = formatGitHubComment(review, sub)
    expect(comment).toContain('🔴 Blocking Issues')
  })

  it('includes testing recommendations', () => {
    const state = buildInitialState(review)
    const sub = buildSubmission(state, true)
    const comment = formatGitHubComment(review, sub)
    expect(comment).toContain('Run unit tests')
  })
})
