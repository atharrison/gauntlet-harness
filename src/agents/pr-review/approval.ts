import type {
  PRReview,
  Finding,
  FindingDecision,
  ReviewSubmission,
} from './schema'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DecisionAction = 'ACCEPT' | 'REJECT' | 'EDIT'

export interface ApprovalState {
  reviewId: string
  decisions: Record<string, FindingDecision>
  submitting: boolean
  submitted: boolean
  result: ReviewSubmission | null
}

// ── Initial state ─────────────────────────────────────────────────────────────

/**
 * Build the initial decision map from a PRReview.
 * BLOCKINGs and SUGGESTIONs default to ACCEPT; NITs default to REJECT
 * (matching the approval UI checkbox spec).
 */
export function buildInitialDecisions(
  review: PRReview
): Record<string, FindingDecision> {
  const allFindings = [
    ...review.blockingIssues,
    ...review.suggestions,
    ...review.nits,
  ]
  return Object.fromEntries(
    allFindings.map(f => [
      f.id,
      {
        findingId: f.id,
        action: (f.severity === 'NIT' ? 'REJECT' : 'ACCEPT') as DecisionAction,
        editedBody: undefined,
      },
    ])
  )
}

export function buildInitialState(review: PRReview): ApprovalState {
  return {
    reviewId: review.reviewId,
    decisions: buildInitialDecisions(review),
    submitting: false,
    submitted: false,
    result: null,
  }
}

// ── State transitions ─────────────────────────────────────────────────────────

export function toggleDecision(
  state: ApprovalState,
  findingId: string
): ApprovalState {
  const current = state.decisions[findingId]
  if (!current) return state
  const next: DecisionAction =
    current.action === 'ACCEPT' ? 'REJECT' : 'ACCEPT'
  return {
    ...state,
    decisions: {
      ...state.decisions,
      [findingId]: { ...current, action: next },
    },
  }
}

export function editFinding(
  state: ApprovalState,
  findingId: string,
  editedBody: string
): ApprovalState {
  const current = state.decisions[findingId]
  if (!current) return state
  return {
    ...state,
    decisions: {
      ...state.decisions,
      [findingId]: { ...current, action: 'EDIT', editedBody },
    },
  }
}

// ── Submission ────────────────────────────────────────────────────────────────

/**
 * Build the final ReviewSubmission from the current approval state.
 * Filters out REJECT decisions so only accepted/edited findings are included.
 */
export function buildSubmission(
  state: ApprovalState,
  postToGitHub: boolean
): ReviewSubmission {
  return {
    reviewId: state.reviewId,
    decisions: Object.values(state.decisions),
    postToGitHub,
  }
}

// ── Summary helpers ───────────────────────────────────────────────────────────

export interface ApprovalSummary {
  total: number
  accepted: number
  rejected: number
  edited: number
  blockingAccepted: number
}

export function summariseDecisions(
  review: PRReview,
  state: ApprovalState
): ApprovalSummary {
  const allFindings = [
    ...review.blockingIssues,
    ...review.suggestions,
    ...review.nits,
  ]
  const byId = new Map<string, Finding>(allFindings.map(f => [f.id, f]))

  let accepted = 0
  let rejected = 0
  let edited = 0
  let blockingAccepted = 0

  for (const decision of Object.values(state.decisions)) {
    if (decision.action === 'ACCEPT') {
      accepted++
      const finding = byId.get(decision.findingId)
      if (finding?.severity === 'BLOCKING') blockingAccepted++
    } else if (decision.action === 'REJECT') {
      rejected++
    } else {
      edited++
      accepted++ // edited = included
    }
  }

  return { total: allFindings.length, accepted, rejected, edited, blockingAccepted }
}

/**
 * Format a ReviewSubmission into a GitHub-ready markdown comment body.
 * Used by the finalize route when postToGitHub=true.
 */
export function formatGitHubComment(
  review: PRReview,
  submission: ReviewSubmission
): string {
  const accepted = submission.decisions.filter(d => d.action !== 'REJECT')
  const allFindings = [
    ...review.blockingIssues,
    ...review.suggestions,
    ...review.nits,
  ]
  const byId = new Map<string, Finding>(allFindings.map(f => [f.id, f]))

  const lines: string[] = [
    `## AI PR Review — ${review.verdict}`,
    '',
    review.verdictSummary,
    '',
    review.summary,
    '',
  ]

  if (review.blockingIssues.length > 0) {
    lines.push('### 🔴 Blocking Issues')
    for (const d of accepted) {
      const f = byId.get(d.findingId)
      if (!f || f.severity !== 'BLOCKING') continue
      const body = d.editedBody ?? f.body
      lines.push(`\n**${f.title}** (\`${f.file}${f.line ? `:${f.line}` : ''}\`)`)
      lines.push(body)
      if (f.suggestedFix) lines.push(`\n> Suggested fix: ${f.suggestedFix}`)
    }
    lines.push('')
  }

  if (review.suggestions.length > 0) {
    lines.push('### ⚠️ Suggestions')
    for (const d of accepted) {
      const f = byId.get(d.findingId)
      if (!f || f.severity !== 'SUGGESTION') continue
      const body = d.editedBody ?? f.body
      lines.push(`\n**${f.title}** (\`${f.file}${f.line ? `:${f.line}` : ''}\`)`)
      lines.push(body)
    }
    lines.push('')
  }

  if (review.whatLooksGood.length > 0) {
    lines.push('### ✅ What Looks Good')
    review.whatLooksGood.forEach(w => lines.push(`- ${w}`))
    lines.push('')
  }

  if (review.testingRecommendations.length > 0) {
    lines.push('### 🧪 Testing Recommendations')
    review.testingRecommendations.forEach(t => lines.push(`- ${t}`))
    lines.push('')
  }

  lines.push('---')
  lines.push('*Generated by PR Review Harness — multi-agent analysis (correctness + security)*')

  return lines.join('\n')
}
