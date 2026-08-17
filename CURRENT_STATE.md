> **Starting a new session?** Run `/current-state` to orient before starting work.

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
