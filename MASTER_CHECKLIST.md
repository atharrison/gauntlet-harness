# Gauntlet Harness — Build Day Checklist
**Date:** 2026-06-13 | **Due:** 4:30 PM

Deliverables: repo URL + deployed Railway URL + HARNESS.md + 5-min demo video.

**Deployment stack:** Railway (new project) + existing Supabase instance (auth + memory).
No Vercel. Auth gate included (Supabase SSR, copied from operation-salamander).

### Testing rule
Write the test file alongside each module — not at the end. Tests live in `tests/` mirroring `src/`.
Use **Jest + ts-jest** (same config as polymarket-arbitrage-engine): `jest.mock()` for Anthropic client and
Supabase client. `describe` / `it` / `expect`. Keep tests minimal but meaningful: test the behavior judges
care about (hard stops fire, dispatch blocks bad calls, guardrails catch bad output).
Run `npm test` after each Stream completes before moving to the next phase.

---

## 🔒 Phase 1 — Foundation (sequential, ~30 min)
Everything depends on this. Start here.

- [ ] **1.1** Directory scaffold: `app/`, `src/harness/`, `src/memory/`, `src/agents/pr-review/`, `src/cli/`, `tests/`, `reviews/`
- [ ] **1.2** `package.json` + `tsconfig.json` + `jest.config.js` (ts-jest preset, node env) + `.env.example` — install all deps
- [ ] **1.3** `src/agents/pr-review/schema.ts` — Zod schemas: `Finding`, `EnrichedContext`, `DomainResult`, `PRReview`, `FileCoverage`, `AlignmentItem`, `CheckpointRecord`
  - [ ] `tests/schema.test.ts` — valid fixture parses; required fields missing → parse fails
- [ ] **1.4** `src/harness/alarms.ts` — `AlarmType` enum, `AlarmSeverity`, `Alarm` interface, `fireAlarm()`
  - [ ] `tests/alarms.test.ts` — `fireAlarm()` emits correct shape; all `AlarmType` values exist in enum

---

## ⚡ Phase 2+3 — Harness Core & Memory Layer (parallel after Phase 1)

### Stream A — Harness Core (`src/harness/`)
- [ ] **A.1** `models.ts` — `ModelClient` interface + Anthropic adapter
  - [ ] `tests/models.test.ts` — mock adapter returns expected `ModelReply` shape
- [ ] **A.2** `loop.ts` — agent loop: `maxTurns`, `maxTokens`, `timeoutMs` hard stops; fires alarms on breach
  - [ ] `tests/loop.test.ts` — exceeding `maxTurns` fires `TURN_LIMIT_EXCEEDED`; final answer exits cleanly; `REPEATED_TOOL_CALL` detected after 3 identical calls
- [ ] **A.3** `tools.ts` — `ToolRegistry` type, `dispatch()` with allow-list + Zod arg validation
  - [ ] `tests/tools.test.ts` — unknown tool returns error-as-data; invalid args rejected by Zod; known tool executes and returns result
- [ ] **A.4** `checkpoints.ts` — `runCheckpoint()`, `CheckpointStage` enum, Supabase persistence
  - [ ] `tests/checkpoints.test.ts` — PASS writes checkpoint record; FAIL fires `CHECKPOINT_FAILED` alarm; mock store called with correct stage
- [ ] **A.5** `guardrails.ts` — output integrity: schema validation, file citation check, secret scan; fires alarms
  - [ ] `tests/guardrails.test.ts` — hallucinated file citation fires `HALLUCINATED_FILE_CITATION`; secret pattern fires `SECRET_DETECTED`; valid output passes cleanly
- [ ] **A.6** `observability.ts` — OTel tracer setup, `tracedModelCall()`, `recordApprovalDecision()`
  - [ ] `tests/observability.test.ts` — `tracedModelCall()` attaches token + cost attributes to span

### Stream B — Memory Layer (`src/memory/`)
- [ ] **B.1** `store.ts` — `MemoryStore` interface
- [ ] **B.2** `supabase.ts` — `SupabaseMemoryStore` (`memories`, `review_history`, `review_checkpoints` tables)
- [ ] **B.3** `local.ts` — `LocalMemoryStore` (SQLite, CLI fallback)
- [ ] **B.4** Supabase migration SQL — `memories`, `review_history`, `review_checkpoints` tables

---

## ⚡ Phase 4+5a — Tools & Web Shell (parallel after A.3 ToolRegistry type exists)

### Stream C — Tool Implementations
- [ ] **C.1** GitHub tools: `fetch_pr_diff`, `fetch_pr_comments`, `fetch_pr_files`, `post_review_comment`
- [ ] **C.2** Memory tools: `search_past_reviews`, `store_review`, `create_memory`
- [ ] **C.3** Ticket tools: `fetch_ticket` (Linear adapter), `search_tickets`

### Stream D — Web Shell (stub routes now, wire agents later)
- [ ] **D.1** `next.config.ts` (`output: "standalone"`), `app/layout.tsx`, `app/page.tsx`
- [ ] **D.2** Supabase SSR middleware — copy + adapt `middleware.ts` + auth route from operation-salamander
- [ ] **D.3** `app/api/review/start/route.ts` — stub (returns `{ reviewId }`)
- [ ] **D.4** `app/api/review/[id]/route.ts` — SSE stream stub
- [ ] **D.5** `app/api/review/[id]/finalize/route.ts` — stub
- [ ] **D.6** `app/review/[id]/page.tsx` — approval UI shell (finding cards, checkbox, inline edit)

---

## 🔒 Phase 5b — Agents (sequential after A + B + C complete)
- [ ] **5.1** `src/agents/pr-review/prompts.ts` — system prompts + domain instruction blocks *(can draft during Phase 4)*
- [ ] **5.2** `src/agents/pr-review/context-agent.ts` — full loop, tool calls, produces `EnrichedContext`
- [ ] **5.3** `src/agents/pr-review/correctness-agent.ts` — single-shot structured output *(parallel with 5.4)*
- [ ] **5.4** `src/agents/pr-review/security-agent.ts` — single-shot structured output *(parallel with 5.3)*
- [ ] **5.5** `src/agents/pr-review/merge.ts` — dedup by file+line proximity, confidence calibration, sort
- [ ] **5.6** `src/agents/pr-review/coordinator.ts` — orchestrate phases, `Promise.all` fan-out, checkpoint writes
- [ ] **5.7** `src/agents/pr-review/approval.ts` — shared approval state machine (used by CLI + web)
- [ ] **5.8** (stretch) `style-agent.ts`, `conventions-agent.ts`, `performance-agent.ts`

---

## ⚡ Phase 6 — Wire + Deploy (parallel tracks after Phase 5b)

### Stream E — Wire Agents into Web Routes
- [ ] **E.1** Wire `start` route → coordinator, persist `reviewId` to Supabase
- [ ] **E.2** Wire SSE route → stream `DomainResult` + `Alarm` events as agents complete
- [ ] **E.3** Wire `finalize` route → `store_review`, optionally `post_review_comment`

### Stream F — Railway
- [ ] **F.1** `Dockerfile` — copy + adapt from operation-salamander frontend (Node 22 Alpine, standalone)
- [ ] **F.2** Create Railway project, configure env vars:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `LINEAR_API_KEY`
- [ ] **F.3** Push to GitHub → Railway auto-deploy wired
- [ ] **F.4** Smoke test: POST `/api/review/start` with PR #1 URL, verify SSE stream responds

---

## 🔒 Phase 7 — Demo Polish (sequential, end of day)
- [ ] **7.1** End-to-end run against `python-adventofcode2020` PR #1 — verify findings hit known smells
  - Expected: no type hints/docstrings, debug prints, magic `'x'` string, undocumented CRT assumption, duplicate list filtering
- [ ] **7.2** `--quick` mode verified: Correctness + Security only, ~30 sec, BLOCKING findings only
- [ ] **7.3** Write `HARNESS.md` — required deliverable; maps working system to 4-pillar judges' vocabulary
- [ ] **7.4** (bonus) Swap in second agent during demo to prove portability
- [ ] **7.5** Record 5-min demo video

---

## Reference

### Demo target
- Repo: `github.com/atharrison/python-adventofcode2020`
- PR: [#1](https://github.com/atharrison/python-adventofcode2020/pull/1) `ath/DAY-013/task-1` → `main`
- Files: `day13/schedule.py`, `day13/day13.py`, `main.py`
- Known smells planted: no type hints, debug prints, magic `'x'` string, undocumented coprime assumption, duplicate list filtering

### Key files
- `ARCHITECTURE.md` — full design (829 lines, now includes Checkpoints + Alarms sections)
- `docs/multi-agent-design.md` — schema contracts, merge rules, execution modes
- `docs/approval-ui.md` — web + CLI approval UX spec
- `src/agents/pr-review/schema.ts` — single source of truth for all Zod schemas

### 4-pillar mapping (for HARNESS.md)
| Hackathon term | Implementation |
|---|---|
| Guardrails | `src/harness/guardrails.ts` — dispatch allow-list, input/output guards, action sandbox |
| Checkpoints | `src/harness/checkpoints.ts` — 5 named stages, pass/fail criteria, Supabase persistence |
| Material handling | `src/harness/tools.ts` + `dispatch()` + `MemoryStore` interface contracts |
| Alarms | `src/harness/alarms.ts` — named `AlarmType` enum, severity, context, recommendedAction |
