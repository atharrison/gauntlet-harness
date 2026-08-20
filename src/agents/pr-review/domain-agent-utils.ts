/**
 * Shared utilities for single-shot domain agents (correctness, security,
 * conventions, performance, style).
 *
 * Centralising parseDomainResult here means bug fixes and schema changes
 * propagate to all agents automatically.
 */
import { randomUUID } from 'crypto'
import { DomainResultSchema, type DomainResult } from './schema'

/**
 * Parse and validate a raw LLM text response into a typed DomainResult.
 *
 * - Strips markdown fences before parsing.
 * - Stamps real UUIDs on any finding with a placeholder id.
 * - Logs Zod validation failures explicitly so they are distinguishable from
 *   JSON parse failures.
 * - Returns a zero-confidence empty-findings sentinel on any failure path.
 */
export function parseDomainResult(
  text: string,
  domain: DomainResult['domain'],
  durationMs: number,
  tokensUsed: number,
  cost: number
): DomainResult {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0])
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
        cost,
      })
      if (result.success) return result.data

      const zodSuffix =
        process.env.DEBUG_LLM === 'true'
          ? ` Issues: ${JSON.stringify(result.error.issues)}`
          : ''
      console.warn(
        `[${domain.toLowerCase()}-agent] Zod validation failed.${zodSuffix}`
      )
      // Return immediately — do not also fire the generic parse-failure warn.
      return {
        domain,
        findings: [],
        confidence: 0,
        tokensUsed,
        cost,
        durationMs,
      }
    } catch {
      // JSON.parse failed — fall through to empty-findings return
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
    cost,
    durationMs,
  }
}
