import type { ModelClient } from '../../harness/models'
import type { DomainResult, EnrichedContext } from './schema'
import { STYLE_SYSTEM, styleUserPrompt } from './prompts'
import { parseDomainResult } from './domain-agent-utils'

export interface DomainAgentOptions {
  enrichedContext: EnrichedContext
  model: ModelClient
}

/**
 * Style Agent — single-shot structured output.
 * Receives EnrichedContext, returns DomainResult with STYLE findings.
 */
export async function runStyleAgent(
  options: DomainAgentOptions
): Promise<DomainResult> {
  const { enrichedContext, model } = options
  const start = Date.now()

  const contextJson = JSON.stringify(enrichedContext, null, 2)
  const userPrompt = styleUserPrompt(contextJson)

  const reply = await model.chat(
    [{ role: 'user', content: userPrompt }],
    [], // no tools — single-shot
    STYLE_SYSTEM
  )

  const durationMs = Date.now() - start
  return parseDomainResult(
    reply.text,
    'STYLE',
    durationMs,
    reply.usage.inputTokens + reply.usage.outputTokens,
    reply.cost
  )
}
