import { randomUUID } from 'crypto'
import { run } from '../../harness/loop'
import { toToolDefinitions } from '../../harness/tools'
import type { ReviewContext } from '../../harness/context'
import { EnrichedContextSchema, type EnrichedContext } from './schema'
import { CONTEXT_AGENT_SYSTEM } from './prompts'

export interface ContextAgentOptions {
  prUrl: string
  reviewId: string
  context: ReviewContext
}

/**
 * The Context Agent runs a full tool-calling loop against the PR.
 * It fetches the diff, ticket, past reviews, and synthesises them into
 * an EnrichedContext that all domain agents consume.
 *
 * On JSON parse failure it returns a minimal EnrichedContext so domain
 * agents can still run with partial information (graceful degradation).
 */
export async function runContextAgent(
  options: ContextAgentOptions
): Promise<EnrichedContext> {
  const { prUrl, reviewId, context } = options
  const { deps, registry, dispatcher } = context

  const tools = toToolDefinitions(registry)
  const dispatch = dispatcher(reviewId)

  const userMessage = `Please review the following GitHub pull request and gather all context needed for a thorough review.

PR URL: ${prUrl}

Steps:
1. Fetch the PR diff using fetch_pr_diff (extract owner/repo/pull_number from the URL)
2. Fetch the changed files list using fetch_pr_files
3. Look for a Linear ticket ID in the branch name or PR title; if found use fetch_ticket
4. Search past reviews with search_past_reviews for the most-changed files
5. When done gathering, output your EnrichedContext JSON.`

  const start = Date.now()

  const result = await run(userMessage, deps.model, tools, dispatch, {
    maxTurns: 15,
    maxTokens: 150_000,
    timeoutMs: 120_000,
    reviewId,
    systemPrompt: CONTEXT_AGENT_SYSTEM,
  })

  // Parse the final JSON output
  const parsed = tryParseEnrichedContext(result.text, prUrl, reviewId)

  return {
    ...parsed,
    externalContextCalls:
      parsed.externalContextCalls + result.turnsUsed,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryParseEnrichedContext(
  text: string,
  prUrl: string,
  reviewId: string
): EnrichedContext {
  // Strip markdown fences if the model wrapped the JSON anyway
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  // Try to find a JSON object in the text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0])
      const result = EnrichedContextSchema.safeParse(raw)
      if (result.success) return result.data
    } catch {
      // fall through to minimal context
    }
  }

  // Graceful degradation: return a minimal context with whatever we have
  console.warn(
    `[context-agent][${reviewId}] Failed to parse EnrichedContext JSON — using minimal fallback`
  )
  return {
    prUrl,
    prTitle: 'Unknown',
    prAuthor: 'Unknown',
    prBranch: 'Unknown',
    diff: text.substring(0, 10_000), // preserve whatever text we got
    filesChanged: [],
    fileCoverage: [],
    ticketId: undefined,
    ticketSummary: undefined,
    ticketAcceptanceCriteria: [],
    pastReviewSummaries: [],
    memories: [],
    externalContextCalls: 0,
  }
}
