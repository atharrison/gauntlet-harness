# PR Review Agent

**AI-assisted pull request review with human-in-the-loop approval.**
Paste a PR URL, watch five specialized agents review it in parallel, then step
through findings before anything reaches your team. Gets smarter with every
review it runs — past reviews and team standards are injected as context automatically.

---

## How It Works

**Web:** paste a PR URL, watch agents run, curate findings in the approval UI, submit to GitHub.

**CLI:** same harness, same memory — an alternative interface for local workflows.

```
  Fetching PR #123 · branch: feat/ENG-456-add-payment-retry
  Resolved ticket: ENG-456 — Add retry logic for failed payments
  Reading 12 changed files ...

  BLOCKING    PaymentService.ts:88
              Retry loop has no backoff — will hammer the API on failure

  SUGGESTION  auth/middleware.ts:44
              Token expiry not checked before use

  Web: checkbox findings, edit inline → Submit Review → GitHub PR
  CLI: [A]ccept [R]eject [E]dit per finding → reviews/<ticket>_<date>.md
```

For each changed file: **correctness · ticket alignment · security ·
performance · test coverage · documentation.** All criteria live in user-configured
memories — not hardcoded. Stack-specific rules added once, applied to every future review.

Nothing reaches the PR author until you've approved it.

---

## Architecture

```
┌─ Memory Store ──────────────────────────────────────────────┐
│  Code Index (v2)  │  Review History  │  Memories            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    Context Agent
                (full loop + tool calls)
                           │  EnrichedContext
       ┌───────────────────┼───────────────────┐
       ▼       ▼           ▼         ▼          ▼
    Style  Conventions Correctness Security Performance
            (single-shot structured output · parallel)
       └───────────────────┼───────────────────┘
                           │  DomainResult[]
                       Coordinator
                  (dedup · calibrate · sort)
                           │  PRReview (Zod-validated)
                           ▼
                 Approval UI → Supabase → GitHub PR
```

⚡ `--quick` mode: skips Context Agent, runs Correctness + Security only, surfaces BLOCKING findings in ~30 seconds.

**Loop:** Context Agent runs a full tool-call loop (build context → call model → run tool → append → repeat). Domain agents are single-shot structured output — no loop, predictable cost.

**Tools:** `fetch_pr_diff` · `fetch_pr_files` · `fetch_ticket` · `search_past_reviews` · `search_codebase` · `store_review` · `create_memory` · `post_review_comment`

**Guardrails:** GitHub and ticket tracker are read-only. `post_review_comment` is the only write, gated behind the approval UI. File citation check, secret pattern scan, and scope-creep budget enforced on every run.

---

## Observability

Signals designed for a review tool, not a generic agent harness.

| Group        | Key signals                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Coverage** | `files_read/files_in_pr` · `lines_read/lines_in_pr` · `external_context_calls`                                                |
| **Cost**     | `$/review` · `tokens_from_context` vs `tokens_from_diff`                                                                      |
| **Quality**  | `findings_accepted/total` · `findings_edited` · `ticket_resolved` — harvested free from the approval UI, no labeling required |
| **Health**   | `turns_used/turns_max` · `tool_errors`                                                                                        |

Instrumented with **OpenTelemetry** — export to any compatible backend.

---

## Pluggable by Design

| Layer          | Default                | Swap via                                         |
| -------------- | ---------------------- | ------------------------------------------------ |
| LLM            | Anthropic Claude       | `LLM_PROVIDER=openai`                            |
| Git host       | GitHub                 | GitLab _(planned)_                               |
| Ticket tracker | Linear                 | `TicketClient` — Jira, GitHub Issues _(planned)_ |
| Memory         | Supabase (team-shared) | `MEMORY_PROVIDER` env var                        |
| Hosting        | Vercel + Next.js       | Any Node 20 host                                 |

TypeScript up and down the stack. No stack assumptions in the harness core.
MVP ships with GitHub + Linear. Works for any team, any repo.

---

## Getting Started

```bash
# Web (Vercel)
vercel deploy

# CLI
npm install
GITHUB_TOKEN=... LINEAR_API_KEY=... LLM_API_KEY=... \
  npm run review -- https://github.com/org/repo/pull/123

# Quick mode
npm run review -- --quick https://github.com/org/repo/pull/123
```

### Environment variables

| Variable            | Required    | Description                                    |
| ------------------- | ----------- | ---------------------------------------------- |
| `GITHUB_TOKEN`      | Yes         | GitHub personal access token (repo read scope) |
| `LLM_API_KEY`       | Yes         | API key for your LLM provider                  |
| `LLM_PROVIDER`      | No          | `anthropic` (default) · `openai`               |
| `LLM_MODEL`         | No          | Model name (defaults to latest Claude)         |
| `LINEAR_API_KEY`    | No          | Linear API key for ticket context              |
| `TICKET_PROVIDER`   | No          | `linear` (default) · `jira` _(planned)_        |
| `MEMORY_PROVIDER`   | No          | `supabase` (default) · `sqlite`                |
| `SUPABASE_URL`      | If Supabase | Your Supabase project URL                      |
| `SUPABASE_ANON_KEY` | If Supabase | Your Supabase anon key                         |

---

## Docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — full architecture with design rationale
- [`docs/multi-agent-design.md`](docs/multi-agent-design.md) — schema contracts, execution modes, merge rules
- [`docs/approval-ui.md`](docs/approval-ui.md) — web + CLI approval UX spec
