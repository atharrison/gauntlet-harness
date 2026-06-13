import type { DomainResult, Finding } from './schema'

const SEVERITY_ORDER: Record<Finding['severity'], number> = {
  BLOCKING: 0,
  SUGGESTION: 1,
  NIT: 2,
}

/**
 * Merges findings from multiple domain agent results into a single sorted,
 * deduplicated list.
 *
 * Dedup strategy: two findings are considered duplicates when they share the
 * same file AND their lines are within 3 of each other AND their titles share
 * > 50% word overlap. The higher-confidence finding is kept; its severity is
 * promoted to the more severe of the two.
 *
 * Calibration: findings not corroborated by a second agent have their
 * confidence slightly penalised (×0.9) to reflect that a single agent may
 * overstate severity.
 *
 * Sort order: BLOCKING → SUGGESTION → NIT, then by confidence desc.
 */
export function mergeResults(results: DomainResult[]): Finding[] {
  // Flatten all findings
  const all: Finding[] = results.flatMap(r => r.findings)

  // Track which findings have been corroborated by another finding
  const corroborated = new Set<string>()
  const merged: Finding[] = []
  const seen = new Set<string>()

  for (let i = 0; i < all.length; i++) {
    if (seen.has(all[i].id)) continue

    let winner = all[i]

    for (let j = i + 1; j < all.length; j++) {
      if (seen.has(all[j].id)) continue
      if (!isDuplicate(winner, all[j])) continue

      // Duplicate found — merge
      corroborated.add(winner.id)
      corroborated.add(all[j].id)
      seen.add(all[j].id)

      // Keep higher confidence; promote to more severe
      if (all[j].confidence > winner.confidence) {
        winner = {
          ...all[j],
          severity: moreSevere(winner.severity, all[j].severity),
        }
      } else {
        winner = {
          ...winner,
          severity: moreSevere(winner.severity, all[j].severity),
        }
      }
    }

    seen.add(winner.id)
    merged.push(winner)
  }

  // Apply confidence calibration for uncorroborated findings
  const calibrated = merged.map(f =>
    corroborated.has(f.id) ? f : { ...f, confidence: f.confidence * 0.9 }
  )

  // Sort: severity asc (BLOCKING=0), then confidence desc
  return calibrated.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sev !== 0) return sev
    return b.confidence - a.confidence
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDuplicate(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false

  // Line proximity (within 3 lines, or both file-level)
  const aLine = a.line ?? -1
  const bLine = b.line ?? -1
  if (aLine !== -1 && bLine !== -1 && Math.abs(aLine - bLine) > 3) return false

  // Title word overlap > 50%
  return titleOverlap(a.title, b.title) > 0.5
}

function titleOverlap(a: string, b: string): number {
  const wordsA = tokenize(a)
  const setB = new Set(tokenize(b))
  if (wordsA.length === 0 || setB.size === 0) return 0
  const setA = new Set(wordsA)
  const intersection = wordsA.filter(w => setB.has(w)).length
  return intersection / Math.max(setA.size, setB.size)
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function moreSevere(
  a: Finding['severity'],
  b: Finding['severity']
): Finding['severity'] {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b
}

/**
 * Split a merged finding list into the three buckets PRReview uses.
 */
export function bucketFindings(findings: Finding[]): {
  blockingIssues: Finding[]
  suggestions: Finding[]
  nits: Finding[]
} {
  return {
    blockingIssues: findings.filter(f => f.severity === 'BLOCKING'),
    suggestions: findings.filter(f => f.severity === 'SUGGESTION'),
    nits: findings.filter(f => f.severity === 'NIT'),
  }
}
