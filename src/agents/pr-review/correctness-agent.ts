import type { ModelClient } from '../../harness/models'
import type { DomainResult, EnrichedContext } from './schema'
import { CORRECTNESS_SYSTEM, correctnessUserPrompt } from './prompts'
import { parseDomainResult } from './domain-agent-utils'

export interface DomainAgentOptions {
  enrichedContext: EnrichedContext
  model: ModelClient
}

/**
 * Correctness Agent — single-shot structured output.
 * Receives EnrichedContext, returns DomainResult with CORRECTNESS findings.
 */
export async function runCorrectnessAgent(
  options: DomainAgentOptions
): Promise<DomainResult> {
  const { enrichedContext, model } = options
  const start = Date.now()

  const contextJson = JSON.stringify(enrichedContext, null, 2)
  const userPrompt = correctnessUserPrompt(contextJson)

  const reply = await model.chat(
    [{ role: 'user', content: userPrompt }],
    [], // no tools — single-shot
    CORRECTNESS_SYSTEM
  )

  const durationMs = Date.now() - start
  return parseDomainResult(
    reply.text,
    'CORRECTNESS',
    durationMs,
    reply.usage.inputTokens + reply.usage.outputTokens,
    reply.cost
  )
}
