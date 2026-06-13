import { runCheckpoint } from '../../harness/checkpoints'
import type { ReviewContext } from '../../harness/context'
import { PRReviewSchema, type PRReview, type EnrichedContext } from './schema'
import { runContextAgent } from './context-agent'
import { runCorrectnessAgent } from './correctness-agent'
import { runSecurityAgent } from './security-agent'
import { mergeResults, bucketFindings } from './merge'
import { coordinatorSummaryPrompt } from './prompts'
import { withSpan } from '../../harness/observability'

// ── Public interface ──────────────────────────────────────────────────────────

export type ReviewEmitter = (event: string, data: unknown) => void

export interface RunReviewOptions {
  reviewId: string
  prUrl: string
  /** 'quick' skips the context agent and runs only correctness + security */
  mode?: 'full' | 'quick'
  context: ReviewContext
  emit?: ReviewEmitter
}

/**
 * The Coordinator orchestrates the full multi-agent review:
 *
 *  Phase 1: Context Agent (full loop, tool calls) → EnrichedContext
 *  Phase 2: Domain agents in parallel (correctness + security)
 *  Phase 3: Merge + deduplicate findings
 *  Phase 4: Coordinator summary LLM call → PRReview
 *
 * Progress events are emitted via the `emit` callback so the SSE route
 * can stream them to the browser.
 */
export async function runReview(options: RunReviewOptions): Promise<PRReview> {
  const { reviewId, prUrl, mode = 'full', context, emit = () => {} } = options

  return withSpan(
    'harness.review',
    { 'review.id': reviewId, 'pr.url': prUrl, 'review.mode': mode },
    span => _runReview(options, span)
  )
}

async function _runReview(
  options: RunReviewOptions,
  rootSpan: import('@opentelemetry/api').Span
): Promise<PRReview> {
  const { reviewId, prUrl, mode = 'full', context, emit = () => {} } = options
  const { deps } = context

  const runStart = Date.now()
  let totalTokens = 0
  let totalCost = 0
  const phaseDurations: Record<string, number> = {}

  // ── INPUT checkpoint ──────────────────────────────────────────────────────
  const inputStart = Date.now()
  await withSpan(
    'harness.review.input',
    { 'review.id': reviewId },
    async () => {
      await runCheckpoint({
        reviewId,
        stage: 'INPUT',
        store: deps.checkpoints,
        check: () =>
          Promise.resolve({
            pass: Boolean(prUrl),
            payload: { prUrl, mode },
            error: prUrl ? undefined : 'prUrl is required',
          }),
      })
    }
  )
  emit('checkpoint', { stage: 'INPUT', status: 'PASS', reviewId })
  phaseDurations.INPUT = Date.now() - inputStart

  // ── Phase 1: Context Agent ────────────────────────────────────────────────
  let enrichedContext: EnrichedContext
  const contextStart = Date.now()

  if (mode === 'quick') {
    // Minimal context from URL alone — skip the full agent loop
    enrichedContext = {
      prUrl,
      prTitle: 'Quick review',
      prAuthor: 'unknown',
      prBranch: 'unknown',
      diff: '',
      filesChanged: [],
      fileCoverage: [],
      ticketId: undefined,
      ticketSummary: undefined,
      ticketAcceptanceCriteria: [],
      pastReviewSummaries: [],
      memories: [],
      externalContextCalls: 0,
    }
  } else {
    const ctxResult = await withSpan(
      'harness.review.context',
      { 'review.id': reviewId },
      async span => {
        const r = await runCheckpoint({
          reviewId,
          stage: 'CONTEXT',
          store: deps.checkpoints,
          check: async () => {
            const result = await runContextAgent({
              prUrl,
              reviewId,
              context,
              emit,
            })
            const pass = Boolean(
              result.context.diff || result.context.filesChanged.length > 0
            )
            return {
              pass,
              payload: result,
              error: pass
                ? undefined
                : 'Context agent returned empty diff and no files',
            }
          },
        })
        span.setAttributes({
          'tokens.context': r.tokensUsed,
          'files.changed': r.context.filesChanged.length,
          'external.calls': r.context.externalContextCalls,
        })
        return r
      }
    )
    enrichedContext = ctxResult.context
    totalTokens += ctxResult.tokensUsed
    totalCost += ctxResult.cost
    emit('checkpoint', { stage: 'CONTEXT', status: 'PASS', reviewId })
  }
  phaseDurations.CONTEXT = Date.now() - contextStart

  // ── Phase 2: Domain agents (parallel) ────────────────────────────────────
  const domainStart = Date.now()
  // Emit checkpoint events immediately; hold finding events until after merge
  // so the IDs the client receives match the merged PRReview exactly.
  const [correctnessResult, securityResult] = await withSpan(
    'harness.review.domain',
    { 'review.id': reviewId },
    async span => {
      const results = await Promise.all([
        runCorrectnessAgent({ enrichedContext, model: deps.model }).then(r => {
          emit('checkpoint', {
            stage: 'DOMAIN',
            agentName: 'correctness',
            status: 'PASS',
            reviewId,
          })
          return r
        }),
        runSecurityAgent({ enrichedContext, model: deps.model }).then(r => {
          emit('checkpoint', {
            stage: 'DOMAIN',
            agentName: 'security',
            status: 'PASS',
            reviewId,
          })
          return r
        }),
      ])
      span.setAttributes({
        'tokens.correctness': results[0].tokensUsed,
        'tokens.security': results[1].tokensUsed,
        'findings.raw': results[0].findings.length + results[1].findings.length,
      })
      return results
    }
  )
  totalTokens += correctnessResult.tokensUsed + securityResult.tokensUsed
  totalCost += correctnessResult.cost + securityResult.cost
  phaseDurations.DOMAIN = Date.now() - domainStart

  // ── Phase 3: Merge ────────────────────────────────────────────────────────
  const mergedFindings = mergeResults([correctnessResult, securityResult])
  const { blockingIssues, suggestions, nits } = bucketFindings(mergedFindings)

  // Emit findings after merge so client IDs are stable and match the PRReview
  mergedFindings.forEach(f => emit('finding', { finding: f }))

  // ── Phase 4: Coordinator summary ──────────────────────────────────────────
  const outputStart = Date.now()
  const review: PRReview = await withSpan(
    'harness.review.output',
    { 'review.id': reviewId },
    async span => {
      const summaryRaw = await deps.model.chat(
        [
          {
            role: 'user',
            content: coordinatorSummaryPrompt(
              JSON.stringify(enrichedContext, null, 2),
              JSON.stringify(mergedFindings, null, 2)
            ),
          },
        ],
        []
      )
      totalTokens +=
        summaryRaw.usage.inputTokens + summaryRaw.usage.outputTokens
      totalCost += summaryRaw.cost

      const summaryData = parseSummary(summaryRaw.text, enrichedContext)

      // ── OUTPUT checkpoint ───────────────────────────────────────────────
      const r = await runCheckpoint({
        reviewId,
        stage: 'OUTPUT',
        store: deps.checkpoints,
        check: () => {
          const parsed = PRReviewSchema.safeParse({
            reviewId,
            prUrl,
            summary: summaryData.summary,
            fileCoverage: enrichedContext.fileCoverage,
            ticketAlignment: summaryData.ticketAlignment,
            whatLooksGood: summaryData.whatLooksGood,
            blockingIssues,
            suggestions,
            nits,
            questions: summaryData.questions,
            testingRecommendations: summaryData.testingRecommendations,
            verdict: summaryData.verdict,
            verdictSummary: summaryData.verdictSummary,
            confidence:
              (correctnessResult.confidence + securityResult.confidence) / 2,
          })
          return Promise.resolve({
            pass: parsed.success,
            payload: parsed.success ? parsed.data : ({} as PRReview),
            error: parsed.success ? undefined : parsed.error.message,
          })
        },
      })
      span.setAttributes({
        'tokens.summary':
          summaryRaw.usage.inputTokens + summaryRaw.usage.outputTokens,
        'review.verdict': summaryData.verdict,
      })
      return r
    }
  )
  phaseDurations.OUTPUT = Date.now() - outputStart

  const durationMs = Date.now() - runStart
  const findingsCount = mergedFindings.length
  const estimatedCostUsd = Math.round(totalCost * 10000) / 10000

  // ── Stamp root span with final aggregated stats ───────────────────────────
  rootSpan.setAttributes({
    'tokens.total': totalTokens,
    'cost.usd': estimatedCostUsd,
    'findings.count': findingsCount,
    'duration.ms': durationMs,
    'review.verdict': review.verdict,
  })

  // ── Emit observability stats ──────────────────────────────────────────────
  emit('stats', {
    tokensUsed: totalTokens,
    estimatedCostUsd,
    durationMs,
    findingsCount,
    phaseDurations,
  })

  emit('checkpoint', { stage: 'OUTPUT', status: 'PASS', reviewId })
  emit('done', { reviewId })

  // ── Structured completion log (Railway-friendly) ──────────────────────────
  console.log(
    JSON.stringify({
      harness_run_complete: {
        reviewId,
        prUrl,
        tokensUsed: totalTokens,
        estimatedCostUsd,
        durationMs,
        findingsCount,
        phaseDurations,
      },
    })
  )

  return review
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SummaryData {
  summary: string
  whatLooksGood: string[]
  questions: string[]
  testingRecommendations: string[]
  verdict: PRReview['verdict']
  verdictSummary: string
  ticketAlignment: PRReview['ticketAlignment']
}

function parseSummary(text: string, ctx: EnrichedContext): SummaryData {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0])
      return {
        summary: String(raw.summary ?? ''),
        whatLooksGood: Array.isArray(raw.whatLooksGood)
          ? raw.whatLooksGood
          : [],
        questions: Array.isArray(raw.questions) ? raw.questions : [],
        testingRecommendations: Array.isArray(raw.testingRecommendations)
          ? raw.testingRecommendations
          : [],
        verdict: isVerdict(raw.verdict) ? raw.verdict : 'COMMENT',
        verdictSummary: String(raw.verdictSummary ?? ''),
        ticketAlignment: Array.isArray(raw.ticketAlignment)
          ? raw.ticketAlignment
          : [],
      }
    } catch {
      // fall through
    }
  }

  return {
    summary: `Review of ${ctx.prUrl}`,
    whatLooksGood: [],
    questions: [],
    testingRecommendations: [],
    verdict: 'COMMENT',
    verdictSummary: 'Could not generate summary.',
    ticketAlignment: [],
  }
}

function isVerdict(v: unknown): v is PRReview['verdict'] {
  return v === 'APPROVE' || v === 'REQUEST_CHANGES' || v === 'COMMENT'
}
