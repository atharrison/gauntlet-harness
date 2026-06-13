# FIR-5: Next.js Web Shell

## Problem

The harness core (FIR-1–4) has a complete agent loop, tool registry, memory layer, and tool implementations — but no web surface. This PR adds the Next.js application shell: the landing page, all three API routes (as stubs ready for FIR-8 agent wiring), Supabase SSR session middleware, and the approval UI that reviewers will use to accept/reject findings before posting to GitHub.

## Solution

A Next.js 15 App Router application with `output: "standalone"` for Railway Docker deployment. Supabase SSR session management is handled at the middleware layer so every route automatically gets a refreshed session cookie. The three API routes are stubbed with the correct shape and Zod validation — agents slot in during FIR-8 without any route changes. The approval UI is a fully-functional client component wired to the SSE stream and finalize endpoint.

## Key Changes

### Infrastructure
- **`next.config.ts`** — `output: "standalone"` for Railway multi-stage Docker build
- **`postcss.config.mjs`** — Tailwind CSS v4 via `@tailwindcss/postcss`
- **`package.json`** — adds `tailwindcss`, `@tailwindcss/postcss`

### Supabase SSR Auth
- **`middleware.ts`** — refreshes the Supabase session on every request; redirects unauthenticated users away from `/review/*` to home
- **`app/auth/callback/route.ts`** — PKCE code exchange handler for Supabase magic link / OAuth flows
- **`lib/supabase/client.ts`** — browser client (for client components)
- **`lib/supabase/server.ts`** — async server client (for server components + route handlers)

### Pages
- **`app/layout.tsx`** — root layout: dark header with beta badge, Tailwind base
- **`app/page.tsx`** — landing page with PR URL input form and 4-pillar (guardrails, checkpoints, material handling, alarms) feature cards

### API Routes (stubs)
- **`POST /api/review/start`** — validates `prUrl` + `mode` with Zod, mints a `reviewId`, returns 202. `GET` fallback for browser form submissions redirects to `/review/[id]`
- **`GET /api/review/[id]`** — SSE stream; emits `connected` and `done` events now, agent fan-out events (`checkpoint`, `finding`, `alarm`) wired in FIR-8
- **`POST /api/review/[id]/finalize`** — accepts `FindingDecision[]` + `postComment` flag, validates with Zod, returns accepted/rejected tally; agent persistence + GitHub comment posting wired in FIR-8

### Approval UI
- **`app/review/[id]/page.tsx`** — server page wrapper (passes `reviewId` + `prUrl` from params)
- **`app/review/[id]/ReviewShell.tsx`** — client component:
  - Opens an `EventSource` to the SSE route; handles `connected`, `finding`, `checkpoint`, `alarm`, `done` events
  - Finding cards with color-coded `BLOCKING` / `SUGGESTION` / `NIT` severity badges
  - Per-finding include/exclude checkbox (NITs unchecked by default once agents are live)
  - Inline edit for suggested fixes
  - Event log sidebar (visible on `lg+` screens)
  - **Submit** and **Submit + Post to GitHub** buttons, active when stream completes

## Testing

- 72 existing unit tests pass (`npm test`) — no regressions
- `npm run lint` exits clean (0 errors, 0 warnings)
- `npx tsc --noEmit` clean on all new files (pre-existing errors in FIR-2/4 files unchanged)
- API routes can be smoke-tested manually: `POST /api/review/start` with `{"prUrl":"https://github.com/atharrison/python-adventofcode2020/pull/1"}` returns `{"reviewId":"<uuid>","prUrl":"...","mode":"full"}`
- SSE stream: `curl -N http://localhost:3000/api/review/<id>` emits `connected` + `done` events

## Deployment Notes

Requires three env vars at runtime (already documented in `.env.example`):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
No migrations — all auth state is managed by Supabase's existing `auth` schema. Railway env vars configured in FIR-8.
