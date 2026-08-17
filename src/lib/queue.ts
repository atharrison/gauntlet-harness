/**
 * Pure utility functions for the PR review queue.
 * No I/O — safe to unit test without any mocking.
 */

export interface ParsedPrUrl {
  owner: string
  repo: string
  pr_number: number
  /** Canonical PR URL with no query string or hash */
  canonical_url: string
}

/**
 * Parses a GitHub PR URL.
 * Accepts https://github.com/owner/repo/pull/123[?...][#...]
 * Returns null if the URL does not match the expected pattern.
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const match = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  )
  if (!match) return null
  const [, owner, repo, prNumberStr] = match
  const pr_number = parseInt(prNumberStr, 10)
  return {
    owner,
    repo,
    pr_number,
    canonical_url: `https://github.com/${owner}/${repo}/pull/${pr_number}`,
  }
}

/**
 * Parses a repo identifier from a flexible input.
 * Accepts:
 *  - `{ owner, name }` explicit fields
 *  - `{ repoUrl: "https://github.com/owner/name[.git][/...]" }`
 * Returns null if neither form resolves to a valid owner/name pair.
 */
export function parseRepoInput(input: {
  owner?: string
  name?: string
  repoUrl?: string
}): { owner: string; name: string } | null {
  const owner = input.owner?.trim()
  const name = input.name?.trim()
  if (owner && name) return { owner, name }

  if (input.repoUrl) {
    const match = input.repoUrl.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/
    )
    if (match) return { owner: match[1], name: match[2] }
  }

  return null
}
