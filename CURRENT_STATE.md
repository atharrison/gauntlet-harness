> **Starting a new session?** Run `/current-state` to orient before starting work.

---

# Session State — 2026-08-24 22:10

## Context

Gauntlet Harness — shipped ATH-38 (optional OTel tracing) via PR #23, merged tonight. Local `.env` now has `OTEL_TRACES_EXPORTER=NONE` so `npm run dev` stays quiet.

## Decisions Made

- **`OtelExporter` enum (`NONE|CONSOLE|OTLP`)**: UPPER_CASE string values; documented env is `NONE`; lowercase `none` accepted via `toUpperCase()`
- **`withSpan` early-return when disabled**: does not call `end`/`setStatus` on the no-op span; `NOOP_SPAN` still implements those methods so callbacks cannot throw
- **`initTracer()` first-call-wins**: `_tracingEnabled` set before `_initialized` on the NONE path; later env changes are ignored
- **Redact OTLP endpoint in init log**: strip userinfo/query/hash so collector credentials never hit stdout
- **`CURRENT_STATE.md` belongs in feature PRs**: running ledger for future agents, not something to exclude from the ticket diff

## Tickets Touched

- **ATH-38**: Done ✅ (PR #23 merged — three exporter modes + review-round hardening)

## What Was Tried and Abandoned

- Documenting the env default as OTel-standard lowercase `none`: Andrew wants `NONE` as the canonical documented value

## Open Questions / Blockers

- Production webhook still not wired (ATH-36 prerequisite)
- `conventionsDoc` loading from Supabase `settings` deferred to ATH-23

## Next Steps

1. ATH-15 (wire `tracked_prs` to review lifecycle)
2. ATH-30 (link queue rows to past review output)
3. ATH-37 (queue auto-refresh) — small, still open

## Key Files

- `src/harness/observability.ts` — `OtelExporter`, `isNoneExporter()`, `redactOtlpEndpoint()`, `NOOP_SPAN`
- `tests/harness.observability.test.ts` — three-mode coverage + first-init-wins + URL redaction
- `.env.example` — `OTEL_TRACES_EXPORTER=NONE`

---

# Session State — 2026-08-19 22:45

## Context

Gauntlet Harness — shipped ATH-17 (Conventions, Performance, and Style agents) via PR #22, merged tonight. Also fixed two bugs discovered via self-review: silent Zod error swallowing in parseDomainResult, and NITs not appearing in the posted GitHub comment.

## Decisions Made

- **`parseDomainResult` extracted to `domain-agent-utils.ts`**: eliminates copy-paste across all 5 agent files; fixes silent Zod validation failures (now warns explicitly) and ensures bug fixes propagate to all agents automatically
- **`conventionsDoc?: string` in `RunReviewOptions`**: conventions agent accepts optional team conventions doc threaded from coordinator; falls back to built-in defaults; ready for ATH-23 (in-app editor) with no coordinator changes
- **NIT section added to `formatGitHubComment`**: NITs were accepted in the UI but silently dropped — no rendering block existed for them; added `### 💬 Nits` section, only renders when user explicitly accepts a NIT
- **OUTPUT checkpoint as authoritative DOMAIN→done signal**: removed hardcoded `>= 5` agent count from ReviewShell; DOMAIN phase now transitions on OUTPUT checkpoint (server-authoritative), so UI never hangs if an agent fails to emit its checkpoint
- **ATH-38 created**: OTel tracing optional (`OTEL_TRACES_EXPORTER=none`) — no off switch existed for local dev console noise

## Tickets Touched

- **ATH-17**: Done ✅ (PR #22 merged — conventions/performance/style agents + domain-agent-utils refactor + NIT rendering + DOMAIN phase hang fix)
- **ATH-38**: Created — make OTel tracing optional for local dev

## Open Questions / Blockers

- Production webhook still not wired (ATH-36 prerequisite)
- `conventionsDoc` loading from Supabase `settings` deferred to ATH-23

## Next Steps

1. ATH-38 (OTel `OTEL_TRACES_EXPORTER=none`) — quick win, reduce local dev console noise
2. ATH-15 (wire `tracked_prs` to review lifecycle) — closes the loop so queue → review → done is tracked
3. ATH-30 (link queue rows to past review output) — pairs naturally after ATH-15

## Key Files

- `src/agents/pr-review/domain-agent-utils.ts` — shared parseDomainResult (new)
- `src/agents/pr-review/conventions-agent.ts`, `performance-agent.ts`, `style-agent.ts` — new domain agents
- `src/agents/pr-review/approval.ts` — NIT section added to formatGitHubComment
- `app/review/[id]/ReviewShell.tsx` — DOMAIN phase hang fix (OUTPUT checkpoint-driven)

---

# Session State — 2026-08-17 22:28

## Context

Gauntlet Harness — shipped ATH-16 (GitHub webhook receiver, PR #20) and ATH-31 (bypass URL entry from queue, PR #21). Both merged. 5+ review rounds on ATH-16; 2 rounds on ATH-31. Multiple new backlog tickets created; MVP/Remaining milestones set up.

## Decisions Made

- **Full auth before event-type branch** in webhook route: HMAC verification and DB lookup happen before checking `x-github-event`, so non-`pull_request` events still go through full auth (→ 204 after auth)
- **`TIMING_DUMMY_SECRET` pattern**: unknown-repo and null-secret paths perform a dummy `verifyGitHubSignature` call to equalize timing and prevent repo enumeration
- **All 401 bodies identical**: `{ error: 'Unauthorized' }` regardless of failure reason — prevents enumeration
- **`reopened` uses `.update()` not upsert**: explicitly sets `updated_since_review: false` for deterministic state; avoids overwriting fields not owned by reopened event
- **`startingId → Set<string>`** in QueueDisplay: per-row loading state; prevents race where clicking two PRs rapidly re-enables first row's button
- **`res.text()` on error path**: avoids throw when server returns non-JSON (e.g. 502 HTML)

## Tickets Touched

- **ATH-16**: Done ✅ (PR #20 merged)
- **ATH-31**: Done ✅ (PR #21 merged — review-driven hardening in final two commits)
- **ATH-30, 32, 33, 34, 35, 36, 37**: All created in backlog; MVP vs Remaining milestones assigned

## Open Questions / Blockers

- Production webhook not yet wired: need `GITHUB_WEBHOOK_SECRET` Railway env var + GitHub repo webhook configured pointing to `/api/webhooks/github`
- ATH-36 (webhook secret UI) blocks clean self-serve webhook setup

## Next Steps

1. Wire webhook in production: add `GITHUB_WEBHOOK_SECRET` to Railway, configure GitHub repo webhook
2. ATH-37 (queue auto-refresh + manual refresh button) — small, good next ticket
3. ATH-30 (link queue rows to past review output) — pairs well with ATH-37

## Key Files

- `app/api/webhooks/github/route.ts` — webhook receiver (full auth before event branch)
- `src/lib/webhook.ts` — HMAC verify/compute utilities
- `tests/api.webhooks.github.test.ts` — webhook route tests
- `app/queue/QueueDisplay.tsx` — queue UI with hardened handleStartReview

---

# Session State — 2026-08-16 23:23

## Context

Gauntlet Harness — AI-powered PR review tool. Sprint 1 MVP is fully merged and live in production. This session continued from the previous one, shipping ATH-22 and ATH-28 via PR #19 (merged).

## What Was Done This Session

- **ATH-27** (coverage cleanup) merged via PR #18 — responded to review, fixed `mockAnonClient.current` baseline reset
- **Production go-live** — fixed OAuth redirect loop (Supabase provider not enabled, Site URL pointed to localhost, `request.url` returning `0.0.0.0:8080`); added `NEXT_PUBLIC_SITE_URL` env var + `x-forwarded-host` header fallback in auth callback
- **ATH-22** merged via PR #19 — env var startup validation (`src/harness/env.ts` + `instrumentation.ts`), `setReviewSubmission` 500 hardening, SSE error sanitization; 224 tests / 24 suites
- **ATH-28** merged in same PR #19 — `fetch_pr_files` patch limit 8 KB → 32 KB + sentinel on truncation; eliminates false "placeholder code" review findings
- Created **ATH-29** — review comment preview + edit before posting to GitHub
- Created **ATH-28** — diff truncation bug (now Done)

## Decisions Made

- **`process.exit(1)` over `throw`** in `validateEnv()`: throwing lets Next.js wrap the error with its own noisy error block; `process.exit` gives clean output
- **32 KB patch limit** (up from 8 KB): covers typical test files without hitting model context limits; sentinel appended on overflow so agents know content was cut
- **ATH-28 bundled into PR #19**: small and directly related to review quality; no reason to make it a separate PR
- **Concurrent pipeline race (INSERT ON CONFLICT)**: explicitly deferred — not in ATH-22 scope, no ticket yet

## Tickets Touched

- **ATH-22**: Done ✅ (merged PR #19)
- **ATH-27**: Done ✅ (merged PR #18, earlier in session)
- **ATH-28**: Done ✅ (shipped in PR #19)
- **ATH-29**: Created — review comment preview + edit before posting to GitHub

## Open Questions

- Review harness still sees two consecutive "REQUEST_CHANGES" on PR #19 due to diff truncation. Now that ATH-28 is merged, next PR review should get complete diffs. Worth smoke-testing on the next PR.
- Concurrent pipeline race condition still unguarded — worth a ticket before adding more traffic.

## Next Steps

1. Smoke-test a real end-to-end review in production (PRs should now get full diffs)
2. Pick next feature ticket — candidates: ATH-16 (GitHub webhook), ATH-18 (wire search_past_reviews), ATH-19 (review history page), ATH-29 (comment preview/edit)
3. File concurrent pipeline race ticket before it becomes a real incident

## Key Files

- `src/harness/env.ts` — new startup validation module
- `src/tools/github.ts` — patch limit now 32 KB + sentinel
- `app/api/auth/callback/route.ts` — `x-forwarded-host` origin fix + `NEXT_PUBLIC_SITE_URL` override
- `app/api/review/[id]/finalize/route.ts` — `setReviewSubmission` 500 hardening (both paths)
- `app/api/review/[id]/route.ts` — SSE error sanitization

---

# Session State — 2026-08-16 22:15

## Context

Gauntlet Harness — AI-powered PR review tool. Sprint 1 MVP tickets are merged. App is live in production on Railway.

## What Was Done This Session

- **ATH-27** (test coverage cleanup) merged via PR #18 — overall coverage 74.7% → 87.6%
- Responded to PR #18 review: fixed `mockAnonClient.current` baseline reset in GET /api/queue/repos `beforeEach`; clarified false "placeholder tests" finding (reviewer's diff was truncated)
- Created **ATH-28** — bug ticket for review harness truncating long diff hunks causing false positives
- **Production deployment** — fixed OAuth redirect loop:
  - Supabase GitHub provider was not enabled → enabled it with prod OAuth App credentials
  - Supabase Site URL pointed to localhost → updated to Railway URL
  - `request.url` in auth callback returned `0.0.0.0:8080` (Railway internal) → fixed by reading `x-forwarded-host`/`x-forwarded-proto` headers, with `NEXT_PUBLIC_SITE_URL` env var as explicit override
  - Added `NEXT_PUBLIC_SITE_URL` to `.env.example`
  - Committed as `e0f0d0d Adding NEXT_PUBLIC_SITE_URL`
- App is now **live and authenticated** at https://gauntlet-review-harness.up.railway.app

## Decisions Made

- `origin` resolution priority in auth callback: `NEXT_PUBLIC_SITE_URL` > `x-forwarded-host` headers > `request.url` origin
- No `GITHUB_TOKEN` static PAT needed in prod — replaced by GitHub OAuth flow

## Production Env Variables (Railway)

All required vars are set. Key ones added this session:

- `NEXT_PUBLIC_SITE_URL=https://gauntlet-review-harness.up.railway.app`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (prod OAuth App)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (remote Supabase project `diecadjyrngrlveumsqn`)
- `ALLOWED_GITHUB_USERS=atharrison`

## Open Questions

- ATH-28: Where exactly does diff truncation happen in the review pipeline? Likely in `context-agent.ts` or wherever the diff is injected into the prompt.

## Next Steps

- Smoke-test a real PR review end-to-end in production
- Triage remaining backlog tickets for next sprint
- Investigate ATH-28 (diff truncation bug)

## Key Files

- `app/api/auth/callback/route.ts` — origin resolution fix (x-forwarded-\* headers)
- `.env.example` — now documents `NEXT_PUBLIC_SITE_URL`
- `tests/api.queue.test.ts` — GET /api/queue/repos `beforeEach` baseline fix
