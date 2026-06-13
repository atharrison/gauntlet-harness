# PR Review — FIR-8: Railway Deployment + Wire Remaining Routes

**PR:** https://github.com/atharrison/gauntlet-harness/pull/7
**Branch:** `ath/FIR-8/task-1`
**Author:** atharrison
**Reviewer:** Andrew Harrison
**Date:** 2026-06-13

---

## 📂 File Coverage

8 files changed. 7 read in full, 1 legitimately skipped.

| File                                    | Status                                    |
| --------------------------------------- | ----------------------------------------- |
| `Dockerfile`                            | ✅ Read                                   |
| `railway.json`                          | ✅ Read                                   |
| `app/api/health/route.ts`               | ✅ Read                                   |
| `src/harness/review-cache.ts`           | ✅ Read                                   |
| `app/api/review/[id]/route.ts`          | ✅ Read                                   |
| `app/api/review/[id]/finalize/route.ts` | ✅ Read                                   |
| `src/harness/models.ts`                 | ✅ Read (factory section — lines 147–163) |
| `CURRENT_STATE.md`                      | ⬜ Skipped (session notes, not code)      |

---

## 🎫 Ticket Context

**FIR-8**: Wire agents into web routes + Railway deployment.

- E.1: Wire start route → coordinator, persist reviewId to Supabase
- E.2: Wire SSE route → stream domain results (done in FIR-6)
- E.3: Wire finalize route → store_review + optional post_review_comment
- F.1: Dockerfile (multi-stage Node 22 Alpine, non-root)
- F.2: Create Railway project + configure env vars (manual step)
- F.3: Push to GitHub → Railway auto-deploy
- F.4: Smoke test

## Overview

This PR ships the deployment infrastructure and wires the two remaining stub routes. The Dockerfile and `railway.json` enable Railway auto-deploy from GitHub. An in-process `Map`-based review cache bridges the SSE route (where `runReview` executes) to the finalize route (where the user submits decisions later). The finalize route is fully replaced — it now validates decisions, loads the cached `PRReview`, calls `storeReview`, and optionally posts a formatted GitHub comment. A genuine bug in `createModelClient` (required `options` arg, no env var fallbacks) is also fixed, making the factory safe to call from the composition root.

---

## ✅ What Looks Good

- **Dockerfile structure** is clean and idiomatic — separate `deps` stage so `node_modules` aren't rebuilt in CI on every push, `libc6-compat` installed only where needed, correct standalone copy pattern, non-root user with proper `chown`.
- **Cache ordering in SSE route** is correct: `cacheReview()` is called before `send('done')`, so by the time the client receives `done` and the user can submit decisions, the cache entry is guaranteed to be there.
- **Graceful degradation** in finalize: missing `GITHUB_TOKEN` → `{ skipped, reason }`, unparseable URL → `{ skipped, reason }`, `DRY_RUN=true` → body returned without posting, Octokit error → `{ error }` logged but request still 200s. None of these kill the user's ability to save their decisions.
- **`storeReview` non-fatal** — `.catch()` prevents a Supabase hiccup from blocking finalize. Correct for a demo context.
- **`createModelClient` fix** — the original required a non-optional object but the composition root called it with zero args. Now correct.
- **`NEXT_TELEMETRY_DISABLED=1`** in both builder and runner stages — good practice, avoids build-time network calls.

---

## 📋 Ticket Alignment

- [x] E.2: SSE route wired to coordinator (done in FIR-6, confirmed stable in this PR)
- [x] E.3: Finalize route wired — `store_review` + optional `post_review_comment`
- [x] F.1: Dockerfile — multi-stage Node 22 Alpine, non-root user
- [x] F.3: `railway.json` — auto-deploy from GitHub push
- [ ] E.1: Start route → persist `reviewId` to Supabase — **intentionally deferred** (cache approach sufficient for demo)
- [ ] F.2: Create Railway project + configure env vars — **manual step, not code**
- [ ] F.4: Smoke test — **post-deploy manual step**

---

## ⚠️ Suggestions

### 1. Add `.dockerignore` to prevent local `node_modules` from shadowing the clean deps-stage install

`Dockerfile` stage 2 does `COPY --from=deps ... node_modules` then `COPY . .`. If a local `node_modules` directory is in the Docker build context, the second `COPY` overwrites the clean install with whatever is on the host. Railway builds from GitHub (where `node_modules` is gitignored) so this won't bite in CI — but `docker build .` locally would silently use the wrong modules.

Minimal `.dockerignore`:

```
node_modules
.next
.env
coverage
*.tsbuildinfo
```

### 2. Consider invalidating the cache entry after a successful finalize

`review-cache.ts` — an entry lives for 1 hour regardless of whether finalize was already called. A user could double-submit within the window and post two identical GitHub comments. Either delete the entry on success or add a `finalized` flag.

```typescript
// in finalize/route.ts, after storeReview and before returning:
cache.delete(reviewId) // or export an invalidate() helper
```

### 3. `summary.total` in the response reflects findings count, not decisions count

```typescript
// finalize/route.ts line 83-86
const allFindings = [...review.blockingIssues, ...review.suggestions, ...review.nits]
// ...
total: allFindings.length,  // all findings in the review
```

But `accepted + rejected` are counted from `rawDecisions`, which could be a subset (if the UI only submits a partial list). The `total` in the response will mismatch. Either use `rawDecisions.length` for `total`, or rename to `totalFindings` vs `totalDecisions`.

### 4. `createReviewContext()` in finalize creates an unnecessary `ModelClient` instance

```typescript
// finalize/route.ts line 82
const { deps } = createReviewContext()
```

Only `deps.memory` is used. `createReviewContext()` also constructs an `AnthropicClient` (reads and validates `ANTHROPIC_API_KEY`). Non-blocking since the env var will be set in production, but it's wasteful and will throw if `ANTHROPIC_API_KEY` is absent even when memory-only is needed. A future `createMemoryStore()` direct call would be cleaner.

### 5. `railway.json` `startCommand` is redundant with Dockerfile `CMD`

Both define `node server.js`. Railway uses the `railway.json` `startCommand` when present (it overrides `CMD`). They're consistent here so it works correctly, but it's a potential source of confusion if the Dockerfile `CMD` is ever changed without updating `railway.json`. Consider removing `startCommand` from `railway.json` and letting the Dockerfile `CMD` be the source of truth.

---

## 🔴 Blocking Issues

None.

---

## ❓ Questions

1. Does the Railway project need a `PORT` env var set, or does Railway inject it automatically and the `ENV PORT=3000` in the Dockerfile takes precedence? (Railway injects `PORT` at runtime; Dockerfile `ENV PORT=3000` would be overridden, which is fine — just confirming the intent.)
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — is this the correct variable name? The Supabase dashboard calls it `anon key` and `.env.example` may use `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Worth double-checking before Railway is wired.

---

## Testing Recommendations

1. **Local Docker build smoke test:** `docker build -t harness-test . && docker run -p 3000:3000 --env-file .env harness-test` — verify `GET /api/health` returns `{ status: "ok" }`.
2. **Finalize 404 path:** call `POST /api/review/fake-id/finalize` with valid decisions — confirm 404 response with descriptive message.
3. **DRY_RUN mode:** set `DRY_RUN=true`, submit decisions with `postComment: true` — verify response includes `{ comment: { dryRun: true, body: "..." } }` and no GitHub API call is made.
4. **Railway deploy:** push main → confirm Railway build succeeds → hit `/api/health` on the Railway URL.

---

## Verdict

**Approve ✅**

Solid, well-scoped PR that ships everything needed to get the app running on Railway. The in-process cache approach is the right call for a hackathon single-instance deploy, and it's clearly documented. The suggestions above are all minor — the `.dockerignore` and double-submit prevention are the most worth picking up before the demo. No blockers.
