# PR Review — FIR-5 Next.js Web Shell

**PR:** https://github.com/atharrison/gauntlet-harness/pull/5
**Branch:** `ath/FIR-5/task-1`
**Author:** atharrison
**Reviewer:** Andrew Harrison
**Date:** 2026-06-13

---

## 📂 File Coverage

22 files changed. 16 read in full, 6 legitimately skipped.

| File                                    | Status                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `next.config.ts`                        | ✅ Read                                                                 |
| `middleware.ts`                         | ✅ Read                                                                 |
| `lib/supabase/client.ts`                | ✅ Read                                                                 |
| `lib/supabase/server.ts`                | ✅ Read                                                                 |
| `app/auth/callback/route.ts`            | ✅ Read                                                                 |
| `app/layout.tsx`                        | ✅ Read                                                                 |
| `app/page.tsx`                          | ✅ Read                                                                 |
| `app/globals.css`                       | ✅ Read                                                                 |
| `app/api/review/start/route.ts`         | ✅ Read                                                                 |
| `app/api/review/[id]/route.ts`          | ✅ Read                                                                 |
| `app/api/review/[id]/finalize/route.ts` | ✅ Read                                                                 |
| `app/review/[id]/page.tsx`              | ✅ Read                                                                 |
| `app/review/[id]/ReviewShell.tsx`       | ✅ Read                                                                 |
| `postcss.config.mjs`                    | ✅ Read                                                                 |
| `eslint.config.js`                      | ✅ Read                                                                 |
| `src/memory/supabase.ts`                | ✅ Read (env key rename only)                                           |
| `.env`                                  | ✅ Read — **🔴 see blocking issue**                                     |
| `.env.example`                          | ✅ Read                                                                 |
| `PR_DESCRIPTION.md`                     | ⬜ Skipped (documentation artifact, not deployed code)                  |
| `package.json`                          | ⬜ Skipped (dep additions reviewed via imports; no unexpected packages) |
| `package-lock.json`                     | ⬜ Skipped (lock file)                                                  |
| `tsconfig.tsbuildinfo`                  | ⬜ Skipped (incremental build cache)                                    |

---

## 🎫 Ticket Context

**FIR-5**: Next.js web shell with Supabase SSR middleware and stub API routes.

Requirements per MASTER_CHECKLIST.md D.1–D.6:

- D.1: `next.config.ts` (standalone output), `app/layout.tsx`, `app/page.tsx`
- D.2: Supabase SSR middleware + `/auth/callback` route handler using `@supabase/ssr`
- D.3: `POST /api/review/start` stub → returns `{ reviewId }`
- D.4: `GET /api/review/[id]` SSE stream stub
- D.5: `POST /api/review/[id]/finalize` stub
- D.6: `app/review/[id]/page.tsx` approval UI (finding cards, checkbox, inline edit)

## Overview

This PR builds the complete Next.js 15 App Router shell on top of the already-merged harness core (FIR-1–4). It delivers all six D-stream deliverables: infrastructure config, Supabase SSR session middleware with auth callback, three API routes stubbed with Zod validation and correct response shapes, and a fully interactive approval UI client component that drives the SSE stream and finalize endpoint. The routes are empty of agent logic by design — FIR-8 wires them. The UI is production-ready for demo purposes today.

## ✅ What Looks Good

- **Supabase SSR pattern is textbook correct.** `middleware.ts` follows the official `@supabase/ssr` pattern: mutates both `request.cookies` and `supabaseResponse.cookies` in `setAll`, so the refreshed session propagates to both the outgoing response and the next request. Easy to get wrong; this is right.
- **`lib/supabase/server.ts` swallows `setAll` errors in Server Components correctly.** The `try/catch` around `cookieStore.set()` is the documented pattern — Server Components can't set cookies, so the error is expected and safe to ignore.
- **Zod validation on both stubs that receive POST bodies.** `StartReviewBody` and `FinalizeBody` both use `safeParse` and return 422 with `flatten()` details on failure. Clean and consistent.
- **SSE headers are complete.** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` — the last one is essential for Railway/Nginx and easy to miss.
- **`EventSource` cleanup is correct.** `useEffect` returns `() => es.close()` — no memory leak on unmount. `es.close()` is also called on `done` and `error` events before the cleanup fires.
- **NIT auto-deselect is wired.** `accepted: finding.severity !== "NIT"` on line 69 — spec-compliant default.
- **Auth route guard logic is sound.** Guards `/review/*` but explicitly excludes `/auth/*` paths, so the callback route can never redirect-loop itself.
- **`output: "standalone"` in next.config.ts** — correct target for Railway Docker multi-stage build.
- **`GET /api/review/start` browser form fallback** is a nice-to-have that makes the home page form work without JS, and it correctly URL-encodes `prUrl` before embedding in the redirect.

## 📋 Ticket Alignment

- [x] D.1 — `next.config.ts` (standalone), `app/layout.tsx`, `app/page.tsx` ✓
- [x] D.2 — SSR middleware + `/auth/callback` using `@supabase/ssr` ✓
- [x] D.3 — `/api/review/start` stub returns `{ reviewId }` ✓
- [x] D.4 — `/api/review/[id]` SSE stream stub ✓
- [x] D.5 — `/api/review/[id]/finalize` stub ✓
- [x] D.6 — approval UI with finding cards, checkbox, inline edit ✓

All six checklist items delivered.

## 🔴 Blocking Issues

### `.env` committed with real credentials

`.env` is in `.gitignore` but is still git-tracked (it was committed before the ignore entry took effect), so changes to it appear in PR diffs. This commit adds:

```
SUPABASE_DB_PASSWORD=ITbGuWM53urIbqrA
NEXT_PUBLIC_SUPABASE_URL=https://diecadjyrngrlveumsqn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_gpWtlHlxZEEjPYZ2H-oMyw_k1Tn5WjG
```

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intentionally public (anon/publishable key is safe to expose). But **`SUPABASE_DB_PASSWORD` is a real secret** and should never be in a committed file.

Fix before merge:

```bash
# 1. Remove .env from git tracking entirely
git rm --cached .env
# 2. Verify .gitignore has .env
# 3. Rotate SUPABASE_DB_PASSWORD in the Supabase dashboard
# 4. Commit the removal
```

The `NEXT_PUBLIC_*` values are fine to leave in `.env.example` (they're public by design) but `.env` itself should never be tracked.

## ⚠️ Suggestions

### `handleSubmit` has no error boundary for network failures

`ReviewShell.tsx` line 137: `await res.json()` is called unconditionally. If the server returns a non-JSON body (e.g., a 502 from Railway during deploy), this will throw an unhandled promise rejection and leave `submitting` stuck at `true`.

```typescript
// Safer pattern:
try {
  const data = await res.json()
  setSubmitResult(res.ok ? `...` : `Error: ${data.error}`)
} catch {
  setSubmitResult('Error: unexpected server response')
} finally {
  setSubmitting(false)
}
```

### `prUrl` is not validated in the `GET /api/review/start` fallback

The GET handler mints a `reviewId` and redirects to `/review/[id]?prUrl=...` without validating that `prUrl` is actually a GitHub PR URL. The POST handler validates with Zod; the GET should too. A quick check:

```typescript
const parsed = z.string().url().safeParse(prUrl)
if (!parsed.success) {
  return NextResponse.redirect(new URL('/?error=invalid_pr_url', request.url))
}
```

This matters because the `prUrl` value ends up rendered as a link in `ReviewShell.tsx` (`href={prUrl}`) — if someone crafts a `javascript:` URL, it becomes an XSS vector.

### `key={i}` on event log list items

`ReviewShell.tsx` line 314: `key={i}` (array index) is used as React key for the event log `<li>` items. Since events are only ever appended (never reordered or removed), this is functionally correct, but React will warn in strict mode. A quick fix is `key={`${i}-${e.substring(0,20)}`}` or just a running counter ref.

### Middleware could miss the `supabaseResponse` reassignment edge case

In `middleware.ts` lines 15–21: `supabaseResponse` is reassigned inside `setAll` via `NextResponse.next({ request })`. If `setAll` is called, the original `supabaseResponse` is discarded and a fresh one is created — but the fresh one is built from the mutated `request` (which already has the new cookies set via `request.cookies.set`). This is the documented pattern and works correctly. Worth a comment noting this is intentional, since the double-reassignment looks surprising at first read.

### No loading skeleton on the approval page

When the SSE stream is in `"connecting"` or `"running"` state and findings haven't arrived yet, the UI shows a text placeholder. For the demo, a simple animated skeleton for the expected finding card shape would look more polished and demonstrate that the UI knows what it's waiting for.

## ❓ Questions

1. The middleware redirects unauthenticated `/review/*` visitors to home. But `POST /api/review/start` is unprotected — anyone can mint a `reviewId` and hit the SSE + finalize routes without auth. Intentional open-access for the demo, or should the API routes also check session?
2. `GET /api/review/[id]` ignores the `reviewId` param in the stub (no DB lookup). When FIR-8 wires it, will the stream pick up an existing review (if e.g. the page is refreshed) or always start fresh?
3. The `FinalizeBody` schema requires `decisions.length >= 1` (`.min(1)`). If someone approves a review with zero findings and clicks Submit, the request will fail with a 422. Should finalize be allowed with an empty decisions array?

## Testing Recommendations

- `npm run dev` → submit a PR URL on the home page → confirm redirect to `/review/[id]`
- `curl -N http://localhost:3000/api/review/<any-id>` → confirm `connected` and `done` SSE events arrive
- `POST /api/review/start` with bad JSON → confirm 400; with missing `prUrl` → confirm 422
- `POST /api/review/<id>/finalize` with empty `decisions` array → confirm 422 (`.min(1)`)
- Hard-refresh `/review/<id>` while not signed in → confirm redirect to home (middleware guard)
- Visit `/auth/callback?code=bad` → confirm redirect to `/?error=auth_callback_failed`

---

## Verdict

**Approve with one pre-merge fix required**

The implementation is solid — all six D-stream deliverables land correctly, the Supabase SSR wiring follows the official pattern precisely, and the approval UI is demo-ready. One blocking fix needed before merge: remove `.env` from git tracking and rotate `SUPABASE_DB_PASSWORD` (the publishable key is safe but the DB password is not). The suggestions above are all non-blocking improvements that can be addressed in FIR-8 when agents are wired in.
