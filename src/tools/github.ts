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

const FILE_CONTENT_MAX_BYTES = 8 * 1024 // 8 KB per file — guardrail

const DRY_RUN = process.env.DRY_RUN === 'true'

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createGithubTools(octokit: Octokit): Record<string, ToolEntry> {
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
          per_page: 100,
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
          per_page: 100,
        })
        return data.map(f => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ? f.patch.slice(0, FILE_CONTENT_MAX_BYTES) : undefined,
          blobUrl: f.blob_url,
        }))
      },
    },

    post_review_comment: {
      description:
        'Post a review comment to a pull request. Gated by DRY_RUN env var — set DRY_RUN=true to suppress actual posting.',
      schema: PostReviewCommentSchema,
      fn: async ({ owner, repo, pull_number, body }) => {
        if (DRY_RUN) {
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

export function createOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN must be set')
  }
  return new Octokit({ auth: token })
}
