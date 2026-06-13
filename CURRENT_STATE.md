> **Starting a new session?** Run `/current-state` to orient before starting work.

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
