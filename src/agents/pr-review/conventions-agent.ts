import type { ModelClient } from '../../harness/models'
import type { DomainResult, EnrichedContext } from './schema'
import { buildConventionsSystem, conventionsUserPrompt } from './prompts'
import { parseDomainResult } from './domain-agent-utils'

export interface ConventionsAgentOptions {
  enrichedContext: EnrichedContext
  model: ModelClient
  /** Team conventions doc loaded from Supabase settings. Falls back to defaults when absent. */
  conventionsDoc?: string
}

/**
 * Conventions Agent — single-shot structured output.
 * Receives EnrichedContext and an optional team conventions doc,
 * returns DomainResult with CONVENTIONS findings.
 */
export async function runConventionsAgent(
  options: ConventionsAgentOptions
): Promise<DomainResult> {
  const { enrichedContext, model, conventionsDoc } = options
  const start = Date.now()

  const contextJson = JSON.stringify(enrichedContext, null, 2)
  const userPrompt = conventionsUserPrompt(contextJson, conventionsDoc)
  const systemPrompt = buildConventionsSystem(conventionsDoc)

  const reply = await model.chat(
    [{ role: 'user', content: userPrompt }],
    [], // no tools — single-shot
    systemPrompt
  )

  const durationMs = Date.now() - start
  return parseDomainResult(
    reply.text,
    'CONVENTIONS',
    durationMs,
    reply.usage.inputTokens + reply.usage.outputTokens,
    reply.cost
  )
}
