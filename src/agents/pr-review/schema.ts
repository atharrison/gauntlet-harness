import { z } from 'zod'

// ── Finding ───────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['BLOCKING', 'SUGGESTION', 'NIT']),
  category: z.enum([
    'STYLE',
    'CONVENTIONS',
    'CORRECTNESS',
    'SECURITY',
    'PERFORMANCE',
  ]),
  file: z.string(),
  line: z.number().int().positive().optional(),
  title: z.string(),
  body: z.string(),
  confidence: z.number().min(0).max(1),
  suggestedFix: z.string().optional(),
})
export type Finding = z.infer<typeof FindingSchema>

// ── FileCoverage ──────────────────────────────────────────────────────────────

export const FileCoverageSchema = z.object({
  file: z.string(),
  status: z.enum(['READ', 'SKIPPED', 'TRUNCATED']),
  reason: z.string().optional(),
  linesRead: z.number().int().nonnegative().optional(),
  linesTotal: z.number().int().nonnegative().optional(),
})
export type FileCoverage = z.infer<typeof FileCoverageSchema>

// ── AlignmentItem ─────────────────────────────────────────────────────────────

export const AlignmentItemSchema = z.object({
  requirement: z.string(),
  met: z.boolean(),
  location: z.string().optional(),
})
export type AlignmentItem = z.infer<typeof AlignmentItemSchema>

// ── EnrichedContext ───────────────────────────────────────────────────────────
// Output of the Context Agent — shared input to all domain agents.

export const EnrichedContextSchema = z.object({
  prUrl: z.string().url(),
  prTitle: z.string(),
  prAuthor: z.string(),
  prBranch: z.string(),
  diff: z.string(),
  filesChanged: z.array(z.string()),
  fileCoverage: z.array(FileCoverageSchema),
  ticketId: z.string().optional(),
  ticketSummary: z.string().optional(),
  ticketAcceptanceCriteria: z.array(z.string()).optional(),
  pastReviewSummaries: z.array(z.string()).optional(),
  memories: z.array(z.string()).optional(),
  externalContextCalls: z.number().int().nonnegative(),
})
export type EnrichedContext = z.infer<typeof EnrichedContextSchema>

// ── DomainResult ──────────────────────────────────────────────────────────────
// Output of a single domain agent (single-shot structured output).

export const DomainResultSchema = z.object({
  domain: z.enum([
    'STYLE',
    'CONVENTIONS',
    'CORRECTNESS',
    'SECURITY',
    'PERFORMANCE',
  ]),
  findings: z.array(FindingSchema),
  confidence: z.number().min(0).max(1),
  tokensUsed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
})
export type DomainResult = z.infer<typeof DomainResultSchema>

// ── PRReview ──────────────────────────────────────────────────────────────────
// Final merged output from the Coordinator — validated before entering the approval loop.

export const PRReviewSchema = z.object({
  reviewId: z.string(),
  prUrl: z.string().url(),
  summary: z.string(),
  fileCoverage: z.array(FileCoverageSchema),
  ticketAlignment: z.array(AlignmentItemSchema),
  whatLooksGood: z.array(z.string()),
  blockingIssues: z.array(FindingSchema),
  suggestions: z.array(FindingSchema),
  nits: z.array(FindingSchema),
  questions: z.array(z.string()),
  testingRecommendations: z.array(z.string()),
  verdict: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  verdictSummary: z.string(),
  confidence: z.number().min(0).max(1),
})
export type PRReview = z.infer<typeof PRReviewSchema>

// ── FindingDecision ───────────────────────────────────────────────────────────
// Approval loop: what the reviewer decided for each finding.

export const FindingDecisionSchema = z.object({
  findingId: z.string(),
  action: z.enum(['ACCEPT', 'REJECT', 'EDIT']),
  editedTitle: z.string().optional(),
  editedBody: z.string().optional(),
})
export type FindingDecision = z.infer<typeof FindingDecisionSchema>

// ── ReviewSubmission ──────────────────────────────────────────────────────────
// Full approval loop output — decisions + post intent.

export const ReviewSubmissionSchema = z.object({
  reviewId: z.string(),
  decisions: z.array(FindingDecisionSchema),
  postToGitHub: z.boolean(),
})
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>

// ── CheckpointRecord ──────────────────────────────────────────────────────────
// Persisted to Supabase after each checkpoint stage passes.

export const CheckpointStageSchema = z.enum([
  'INPUT',
  'CONTEXT',
  'DOMAIN',
  'OUTPUT',
  'FINALIZE',
])
export type CheckpointStage = z.infer<typeof CheckpointStageSchema>

export const CheckpointRecordSchema = z.object({
  reviewId: z.string(),
  stage: CheckpointStageSchema,
  agentName: z.string().optional(),
  status: z.enum(['PASS', 'FAIL']),
  payload: z.unknown(),
  createdAt: z.string(),
})
export type CheckpointRecord = z.infer<typeof CheckpointRecordSchema>
