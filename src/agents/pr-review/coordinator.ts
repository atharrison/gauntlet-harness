import { runCheckpoint } from '../../harness/checkpoints'
import type { ReviewContext } from '../../harness/context'
import { PRReviewSchema, type PRReview, type EnrichedContext } from './schema'
import { runContextAgent } from './context-agent'
import { runCorrectnessAgent } from './correctness-agent'
import { runSecurityAgent } from './security-agent'
import { mergeResults, bucketFindings } from './merge'
import { coordinatorSummaryPrompt } from './prompts'

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
  const { deps } = context

  const runStart = Date.now()
  let totalTokens = 0
  let totalCost = 0
  const phaseDurations: Record<string, number> = {}

  // ── INPUT checkpoint ──────────────────────────────────────────────────────
  const inputStart = Date.now()
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
    const ctxResult = await runCheckpoint({
      reviewId,
      stage: 'CONTEXT',
      store: deps.checkpoints,
      check: async () => {
        const r = await runContextAgent({ prUrl, reviewId, context, emit })
        const pass = Boolean(r.context.diff || r.context.filesChanged.length > 0)
        return {
          pass,
          payload: r,
          error: pass
            ? undefined
            : 'Context agent returned empty diff and no files',
        }
      },
    })
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
  const [correctnessResult, securityResult] = await Promise.all([
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
  totalTokens += correctnessResult.tokensUsed + securityResult.tokensUsed
  phaseDurations.DOMAIN = Date.now() - domainStart

  // ── Phase 3: Merge ────────────────────────────────────────────────────────
  const mergedFindings = mergeResults([correctnessResult, securityResult])
  const { blockingIssues, suggestions, nits } = bucketFindings(mergedFindings)

  // Emit findings after merge so client IDs are stable and match the PRReview
  mergedFindings.forEach(f => emit('finding', { finding: f }))

  // ── Phase 4: Coordinator summary ──────────────────────────────────────────
  const outputStart = Date.now()
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
  totalTokens += summaryRaw.usage.inputTokens + summaryRaw.usage.outputTokens
  totalCost += summaryRaw.cost

  const summaryData = parseSummary(summaryRaw.text, enrichedContext)

  // ── OUTPUT checkpoint ─────────────────────────────────────────────────────
  const review: PRReview = await runCheckpoint({
    reviewId,
    stage: 'OUTPUT',
    store: deps.checkpoints,
    check: () => {
      const r = PRReviewSchema.safeParse({
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
        pass: r.success,
        payload: r.success ? r.data : ({} as PRReview),
        error: r.success ? undefined : r.error.message,
      })
    },
  })
  phaseDurations.OUTPUT = Date.now() - outputStart

  const durationMs = Date.now() - runStart
  const findingsCount = mergedFindings.length
  const estimatedCostUsd = Math.round(totalCost * 10000) / 10000

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
