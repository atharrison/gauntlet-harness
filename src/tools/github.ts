import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import type { ToolEntry } from '../harness/tools'

// ── Schemas ───────────────────────────────────────────────────────────────────

const FetchPrDiffSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
})

const FetchPrCommentsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
})

const FetchPrFilesSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
})

const PostReviewCommentSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
  body: z.string(),
})

const FILE_CONTENT_MAX_BYTES = 32 * 1024 // 32 KB per file — covers typical test files

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createGithubTools(
  octokit: Octokit | null
): Record<string, ToolEntry> {
  // No token → no GitHub tools in the registry. The model adapts its strategy
  // rather than encountering stub errors.
  if (!octokit) return {}
  return {
    fetch_pr_diff: {
      description:
        'Fetch the unified diff for a pull request. Returns the raw patch text.',
      schema: FetchPrDiffSchema,
      fn: async ({ owner, repo, pull_number }) => {
        const { data } = await octokit.pulls.get({
          owner,
          repo,
          pull_number,
          mediaType: { format: 'diff' },
        })
        // Octokit returns the raw diff as a string for the 'diff' media type,
        // but the TS types don't model custom media overrides — cast is intentional.
        return { diff: data as unknown as string }
      },
    },

    fetch_pr_comments: {
      description:
        'Fetch existing review comments on a pull request. Useful for context on prior feedback.',
      schema: FetchPrCommentsSchema,
      fn: async ({ owner, repo, pull_number }) => {
        const { data } = await octokit.pulls.listReviewComments({
          owner,
          repo,
          pull_number,
          per_page: 100, // MVP: no pagination; sufficient for demo target
        })
        return data.map(c => ({
          id: c.id,
          path: c.path,
          line: c.line,
          body: c.body,
          author: c.user?.login,
          createdAt: c.created_at,
        }))
      },
    },

    fetch_pr_files: {
      description:
        'Fetch the list of files changed in a pull request, with their patch and content (truncated to 8 KB per file).',
      schema: FetchPrFilesSchema,
      fn: async ({ owner, repo, pull_number }) => {
        const { data } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number,
          per_page: 100, // MVP: no pagination; GitHub caps at 300 files total
        })
        return data.map(f => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch
            ? f.patch.length > FILE_CONTENT_MAX_BYTES
              ? f.patch.slice(0, FILE_CONTENT_MAX_BYTES) +
                `\n// [patch truncated — ${f.patch.length - FILE_CONTENT_MAX_BYTES} bytes omitted]`
              : f.patch
            : undefined,
          blobUrl: f.blob_url,
        }))
      },
    },

    post_review_comment: {
      description:
        'Post a review comment to a pull request. Gated by DRY_RUN env var — set DRY_RUN=true to suppress actual posting.',
      schema: PostReviewCommentSchema,
      fn: async ({ owner, repo, pull_number, body }) => {
        if (process.env.DRY_RUN === 'true') {
          return {
            dryRun: true,
            message: 'DRY_RUN=true — comment not posted',
            body,
          }
        }
        const { data } = await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pull_number,
          body,
        })
        return { id: data.id, url: data.html_url }
      },
    },
  }
}

// ── Octokit factory ───────────────────────────────────────────────────────────

/**
 * Create an authenticated Octokit instance.
 *
 * Token priority:
 *   1. `token` argument — GitHub OAuth access token from the user's session
 *      (set when the user authenticates via GitHub OAuth in the web app).
 *   2. `GITHUB_TOKEN` env var — static PAT for CLI usage and local dev without OAuth.
 *
 * Returns null if no token is available; callers degrade gracefully (no GitHub tools).
 */
export function createOctokit(token?: string | null): Octokit | null {
  const auth = token ?? process.env.GITHUB_TOKEN
  if (!auth) return null
  return new Octokit({ auth })
}
