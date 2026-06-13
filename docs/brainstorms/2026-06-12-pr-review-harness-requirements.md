# PR Review Harness — Requirements

**Date:** 2026-06-12
**Status:** Active

---

## What We're Building

A standalone, open-source CLI tool that uses an LLM agent harness to review
GitHub pull requests. The reviewer provides a PR URL, the agent fetches context
(diff, files, Linear ticket), analyzes the changes, and produces a structured
markdown review file. The reviewer steps through each finding interactively
before anything is saved or posted.

---

## Primary Actor

A software engineer (the reviewer) who wants AI assistance producing a thorough,
structured PR review. The tool is stack-agnostic — it works for any GitHub-hosted
repo and any engineering team.

---

## Core Outcome

The reviewer runs one command, steps through the agent's findings, accepts or
rejects each one, and ends up with a polished markdown review file they stand
behind. The file is ready to reference, share, or post to the PR.

---

## Functional Requirements

### Entry Point

- The reviewer invokes the tool with a GitHub PR URL:
  `npm run review -- https://github.com/org/repo/pull/123`
- No other required input. All context (diff, files, Linear ticket) is fetched
  by the agent.

### Agent Behavior

- Fetch the PR diff and list of changed files via GitHub API.
- Read each changed file in full (up to 8 KB per file; truncation noted in
  file coverage table).
- Auto-resolve the linked Linear ticket from branch name or PR body (e.g.,
  `ENG-123` pattern); fetch ticket description and acceptance criteria.
- If no Linear ticket is found, proceed without it — ticket context is
  optional.
- Analyze each file against the review criteria encoded in the system prompt
  and user-configured memories.
- Produce a structured `PRReview` object validated against the output schema
  before the approval loop begins.

### Review Criteria

- Review criteria are **not hardcoded** in the tool. Generic criteria
  (correctness, readability, security basics, test coverage) live in the base
  system prompt.
- Stack-specific or team-specific patterns (e.g., "always check for N+1
  queries in this ORM") are configured by the user as memories. The tool ships
  with no opinions about any particular stack.

### Approval Loop

- After the agent produces a draft, the reviewer steps through each finding
  interactively in the CLI.
- Traversal order: blocking issues → suggestions → nits.
- Per finding, the reviewer can: **[A]ccept**, **[R]eject**, **[E]dit**
  (inline text edit in the terminal), or **[S]kip remaining nits** (bulk
  dismiss all remaining nits in one keystroke).
- After the loop, the reviewer is offered the option to open the draft in
  `$EDITOR` for final free-form polish before writing.
- Only accepted + edited findings appear in the output file.

### Output

- Written to `reviews/<TICKET-ID>_<YYYY-MM-DD>_<short-slug>.md`.
- If no Linear ticket was resolved, the filename uses the PR number:
  `reviews/pr-<number>_<YYYY-MM-DD>_<slug>.md`.
- The `reviews/` directory is gitignored by default; reviewer opts in to
  committing review files.
- Output follows the standard review template (see `ARCHITECTURE.md` for
  section structure).

### Memory

- The tool ships with a `LocalMemoryStore` (SQLite + local embeddings) that
  works with zero infra.
- Users can optionally configure a `SupabaseMemoryStore` for team-shared
  memory via environment variables.
- Memories are scoped per repo name. Running the tool on a new repo starts
  with no memories until the user creates some.
- After each accepted review, the tool offers: "Save any patterns from this
  review as memories? [y/N]". Accepting launches a short interactive flow.

### Observability

- Every model call and tool call emits an OTel span with `llm.tokens_in`,
  `llm.tokens_out`, `llm.cost_usd`, and latency.
- Default exporter: OTLP → stdout (structured JSON). Configurable via
  `OTEL_EXPORTER_*` env vars to point at any OTel-compatible backend.

---

## Non-Functional Requirements

- **Zero required infra.** A fresh `npm install` + API keys in `.env` is enough
  to run a review.
- **Model-agnostic.** LLM provider and model are selected via `LLM_PROVIDER`
  and `LLM_MODEL` env vars. Ships with Anthropic and OpenAI adapters.
- **No stack assumptions in code.** No Supabase, Rails, or framework-specific
  logic exists in the codebase. All such patterns live in user memories.
- **Open-source safe.** No proprietary team data, internal tooling references,
  or non-public API integrations hardcoded.

---

## Scope Boundaries

### In scope for v1

- CLI entry point with manual PR URL input
- GitHub integration: diff, file list, file contents, existing comments
- Linear integration: ticket description + AC, auto-resolved from branch/body
- Approval loop: per-finding accept/reject/edit + bulk nit skip + `$EDITOR` polish
- Output: markdown file to `reviews/`
- LocalMemoryStore (SQLite)
- OTel stdout observability
- Anthropic + OpenAI model adapters

### Deferred for later

- `list_open_prs(repo)` — interactive PR selection before review
- Post-approval GitHub submission (stretch goal; requires `gh` auth or GitHub MCP)
- SupabaseMemoryStore (interface is defined; adapter implementation is post-v1)
- Web UI or Slack bot integration
- Parallel tool execution

### Out of scope

- Auto-triggered reviews on PR open/update (no CI/CD integration in v1)
- Support for GitLab, Bitbucket, or non-GitHub hosts
- Real-time collaboration / multi-reviewer workflows

---

## Success Criteria

- Reviewer can run `npm run review -- <url>` against a real PR and receive a
  structured review file without writing any code.
- The approval loop correctly filters out at least one finding the reviewer
  rejects in a demo run.
- OTel stdout shows token cost and latency for each model call.
- A second review on the same repo incorporates a memory created during the
  first review (demonstrates the memory loop working end-to-end).

---

## Open Questions

- Should the `$EDITOR` step open automatically after the approval loop, or only
  when the reviewer requests it (e.g., with `--edit` flag)?
- What is the right `maxTurns` default for a typical PR review? (10 is the
  current guess; needs eval data.)
- How should the tool handle a PR with 50+ changed files — truncate the file
  list, or process in batches across multiple loop iterations?
