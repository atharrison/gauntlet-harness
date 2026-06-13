> **Starting a new session?** Run `/current-state` to orient before starting work.

---

# Session State — 2026-06-13 10:47

## Context

Gauntlet hackathon (Fired Festival). FIR-1 through FIR-4 are all merged to `main`. Currently on `main`. Next up: FIR-5 (Next.js web shell) → FIR-6 (agents) → FIR-8 (wire + deploy) → FIR-7 (demo polish). Due 4:30 PM today.

## Decisions Made

- **Railway + Supabase (not Vercel)**: deployment target changed from Vercel to existing Railway project. New Railway deployment(s) for this app, existing Supabase instance for auth + memory.
- **Jest + ts-jest (not Vitest)**: switched testing framework to Jest for consistency with other Andrew projects.
- **Two-tier CI**: `unit` job (fast, no services) + `integration` job (postgres:16 service). `npm test` excludes integration, `npm run test:integration` runs them via dotenvx. `docker-compose.yml` mirrors CI locally.
- **ESLint v9 flat config + Prettier**: `eslint.config.js` (CommonJS format to avoid MODULE_TYPELESS_PACKAGE_JSON warning). `__mocks__/**` excluded from ESLint. `.prettierrc` with `prettier-plugin-sql`.
- **`@octokit/rest` ESM fix**: `__mocks__/@octokit/rest.js` + `moduleNameMapper` in `jest.config.js` — proper CJS stub. No more `require()` hack in production code.
- **Graceful degradation pattern**: `createOctokit()` returns `null` when `GITHUB_TOKEN` absent (GitHub tools excluded from registry). `createLinearClient()` returns `null` when `LINEAR_API_KEY` absent (ticket tools return error-as-data). Both match same pattern.
- **Composition root**: `src/harness/context.ts` — `createReviewContext()` is the single factory for CLI and web. `buildRegistry()` spreads all tool factories.
- **`UNIQUE NULLS NOT DISTINCT`**: Used in `review_checkpoints` for `(review_id, stage, agent_name)` constraint — allows parallel agents to write same stage with different `agent_name`, but enforces uniqueness for null `agent_name`.

## Tickets Touched

- **FIR-1**: merged — scaffold, schema, alarms (25 tests)
- **FIR-2**: merged — harness core (loop, tools, checkpoints, guardrails, observability)
- **FIR-3**: merged — memory layer (MemoryStore, LocalMemoryStore, SupabaseMemoryStore, Supabase migration, Postgres integration tests)
- **FIR-4**: merged — tool implementations (github.ts, memory.ts, tickets.ts), buildRegistry(), ESM fix, linting/formatting

## What Was Tried and Abandoned

- `transformIgnorePatterns` to handle `@octokit/rest` ESM: didn't reach transitive `@octokit/core` imports. Replaced with `moduleNameMapper` CJS stub.
- `jest.mock('@octokit/rest')` in test files: worked but was noisy boilerplate. Replaced with global `moduleNameMapper`.
- `require()` lazy-load in `buildRegistry()` to avoid ESM at import time: worked but blocked TypeScript static analysis. Replaced with proper stub + static import.
- `DRY_RUN` as module-level constant: made the env var unobservable after module load. Fixed to read `process.env.DRY_RUN` at call time.
- `testPathIgnorePatterns` in `jest.config.js` for integration tests: conflicted with `--testPathPattern` CLI flag. Moved to `npm test` script as `--testPathIgnorePatterns=tests/integration`.

## Open Questions / Blockers

- `search_codebase` tool (code index / vector search) — skipped in FIR-4; `MemoryStore.searchCode()` exists but not exposed as a tool. Intentional MVP skip.
- `post_review_comment` posts to `issues.createComment` (PR-level), not `pulls.createReviewComment` (line-level inline). Sufficient for demo?
- GitHub token scope needed for `post_review_comment` — confirm before wiring finalize route.
- FIR-5 needs: Supabase SSR middleware, `@supabase/ssr`, Next.js 15 App Router.

## Next Steps

1. **FIR-5**: Next.js web shell — `next.config.ts` (`output: "standalone"`), `app/layout.tsx`, `app/page.tsx`, Supabase SSR middleware, stub API routes (`/api/review/start`, `/api/review/[id]` SSE, `/api/review/[id]/finalize`), approval UI shell
2. **FIR-6**: Agents — prompts, context-agent, correctness-agent, security-agent, merge, coordinator, approval state machine
3. **FIR-8**: Wire agents into routes + Railway Dockerfile + env vars + smoke test
4. **FIR-7**: End-to-end demo run, HARNESS.md, 5-min video

## Key Files

- `MASTER_CHECKLIST.md` — primary task tracker (FIR-1/2/3/4 ✅, FIR-5/6/8/7 pending)
- `ARCHITECTURE.md` — full design spec (~830 lines, authoritative)
- `src/harness/context.ts` — composition root; `createReviewContext()` + `buildRegistry()`
- `src/tools/github.ts`, `src/tools/memory.ts`, `src/tools/tickets.ts` — tool factories
- `src/harness/loop.ts` — agent loop (maxTurns, maxTokens, timeoutMs hard stops)
- `src/harness/tools.ts` — `dispatch()` + `toToolDefinitions()`
- `src/memory/store.ts` — `MemoryStore` interface
- `supabase/migrations/20260613_memory_tables.sql` — Supabase schema
- `tests/integration/db.test.ts` — Postgres integration tests (need Docker running: `docker compose up -d`)
- `.env` — `TEST_POSTGRES_URL` for local integration tests (gitignored)
- `__mocks__/@octokit/rest.js` — CJS stub for ESM Octokit in Jest

---

# Session State — 2026-06-13 01:01

## Context

Gauntlet hackathon (Fired Festival). Architecture/design phase complete. Submitted one-pager PDF. 8am start tomorrow to build the actual implementation.

## Decisions Made

- **Web-first delivery**: Next.js on Vercel is the primary interface. CLI is a secondary alternative using the same harness core.
- **Multi-agent fan-out**: Context Agent (full loop, tool calls) → 5 parallel domain agents (Style, Conventions, Correctness, Security, Performance) as single-shot structured output → Coordinator merges.
- **Memory MVP scope**: Memories + Review History ship in v1 (simple Supabase tables). Code Index deferred to v2 — needs background indexer job.
- **SQLite is zero-config fallback** for CLI, not the CLI's identity. Both CLI and web use `MEMORY_PROVIDER` env var.
- **Approval UI**: Web = checkbox finding cards (nits unchecked by default), inline edit, submit. CLI = sequential [A]ccept/[R]eject/[E]dit with nit batch at end.
- **`--quick` mode**: Skips Context Agent, Correctness + Security only, BLOCKING findings, ~30 sec.
- **Guardrails**: GitHub/ticket read-only, post_review_comment gated behind approval, file citation check, secret scan, scope-creep budget.
- **Observability signals**: Coverage (files_read/files_in_pr, lines_read, external_context_calls), Cost ($/review, context vs diff split), Quality (acceptance rate, edit rate, ticket_resolved — free from approval loop), Health (turns_used, tool_errors).

## Key Files

- `ARCHITECTURE.md` — full design, ~724 lines
- `ARCHITECTURE_ONE_PAGER.md` — submission one-pager
- `docs/multi-agent-design.md` — schema contracts (Finding, EnrichedContext, DomainResult, PRReview), execution modes, merge rules
- `docs/approval-ui.md` — web + CLI approval UX spec, FindingDecision/ReviewSubmission schema
- `docs/brainstorms/2026-06-12-pr-review-harness-requirements.md` — requirements doc
- `generated/ARCHITECTURE_ONE_PAGER.html` — styled HTML (moved to docs/ for git checkin)
- `README.md` — created tonight, one-pager content + getting started + env vars

## Next Steps (8am)

1. Scaffold `src/harness/` — loop.ts, tools.ts, guardrails.ts, models.ts (ModelClient interface + Anthropic adapter)
2. Scaffold `src/memory/` — MemoryStore interface, SupabaseMemoryStore (reviews + memories tables only)
3. Build Context Agent + Correctness domain agent as first working vertical slice
4. Next.js shell — /api/review/start route, bare approval UI page
5. Wire Supabase: two tables — `memories`, `review_history`

## Demo Target Repo

- **`github.com/atharrison/python-adventofcode2020`** — Andrew's public repo, now on `main` (was `master`, fast-forwarded tonight)
- PR open: [#1](https://github.com/atharrison/python-adventofcode2020/pull/1) `ath/DAY-013/task-1` → `main` (3 commits)
  - `day13/schedule.py` — `BusSchedule` helper (mirrors bag_graph.py/interpreter.py pattern)
  - `day13/day13.py` — delegates to `BusSchedule`; sieve/CRT in Part 2
  - `main.py` — intentionally left with "edit 3 places per new day" smell for agent to find
  - Review surface: no type hints/docstrings, debug prints, magic `'x'` string, undocumented coprime assumption, duplicate list filtering across `get_active_buses` vs `get_constraints`
  - Sample answers verified: Part 1 = 295, Part 2 = 1068781; real input verified locally (not committed)
  - `day13input.txt` gitignored; real input on disk at that path
- `gh` CLI installed and auth'd

## Open Questions

- Will we have time to build the full 5-domain agent set, or ship Correctness + Security for the demo?
- GitHub token scope needed for `post_review_comment` — confirm before wiring the finalize route
- Do we need auth on the Vercel app for the hackathon demo, or is it open? **→ No auth. Open app for demo.**

## Tech Stack Confirmed

- TypeScript, Node 20, ESM
- Next.js 14 App Router (Vercel)
- Supabase + pgvector
- Zod v3 for all schemas
- Anthropic Claude (default LLM, pluggable via ModelClient)
- Linear (MVP ticket tracker, pluggable via TicketClient)
- GitHub via @octokit/rest
- OpenTelemetry
- Vitest
