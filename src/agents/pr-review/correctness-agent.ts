import { randomUUID } from 'crypto'
import type { ModelClient } from '../../harness/models'
import {
  DomainResultSchema,
  type DomainResult,
  type EnrichedContext,
} from './schema'
import { CORRECTNESS_SYSTEM, correctnessUserPrompt } from './prompts'

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
    reply.usage.inputTokens + reply.usage.outputTokens
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDomainResult(
  text: string,
  domain: DomainResult['domain'],
  durationMs: number,
  tokensUsed: number
): DomainResult {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0])
      // Stamp IDs on any findings missing them
      if (Array.isArray(raw.findings)) {
        raw.findings = raw.findings.map((f: Record<string, unknown>) => ({
          ...f,
          id:
            typeof f.id === 'string' && f.id !== '<uuid>' ? f.id : randomUUID(),
          category: domain,
        }))
      }
      const result = DomainResultSchema.safeParse({
        ...raw,
        domain,
        durationMs,
        tokensUsed,
      })
      if (result.success) return result.data
    } catch {
      // fall through
    }
  }

  const debugSuffix =
    process.env.DEBUG_LLM === 'true'
      ? ` Raw output (first 500 chars): ${text.slice(0, 500)}`
      : ''
  console.warn(
    `[${domain.toLowerCase()}-agent] Failed to parse DomainResult JSON.${debugSuffix}`
  )
  return {
    domain,
    findings: [],
    confidence: 0,
    tokensUsed,
    durationMs,
  }
}
