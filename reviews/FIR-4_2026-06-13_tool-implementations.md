# PR Review — FIR-4 Tool Implementations

**PR:** https://github.com/atharrison/gauntlet-harness/pull/4
**Branch:** `ath/FIR-4/task-1`
**Author:** Andrew Harrison
**Reviewer:** Andrew Harrison (self)
**Date:** 2026-06-13

---

## 📂 File Coverage

The PR diff is large because of the rebase (all of FIR-1 through FIR-4 appears vs `main`).
This review scopes to the **FIR-4 delta only**: the three new `src/tools/` files, `context.ts`,
`jest.config.js`, and the three new test files. Everything else was reviewed in FIR-1/2/3.

| File | Status |
|---|---|
| `src/tools/github.ts` | ✅ Read in full |
| `src/tools/memory.ts` | ✅ Read in full |
| `src/tools/tickets.ts` | ✅ Read in full |
| `src/harness/context.ts` | ✅ Read in full |
| `src/harness/tools.ts` | ✅ Read in full (context for ToolEntry interface) |
| `tests/tools.github.test.ts` | ✅ Read in full |
| `tests/tools.memory.test.ts` | ✅ Read in full |
| `tests/tools.tickets.test.ts` | ✅ Read in full |
| `tests/context.test.ts` | ✅ Read in full |
| `jest.config.js` | ✅ Read in full |
| Everything else in diff | ⬜ Skipped (unchanged from prior merged PRs FIR-1/2/3) |

---

## 🎫 Ticket Context

**FIR-4**: Stream C — Tool Implementations
Wire up `fetch_pr_diff`, `fetch_pr_comments`, `fetch_pr_files`, `post_review_comment`,
`search_past_reviews`, `store_review`, `create_memory`, `fetch_ticket`, `search_tickets` —
and register them all in `buildRegistry()`.

## Overview

Three tool factory modules are added (`github.ts`, `memory.ts`, `tickets.ts`), each following
the same pattern: define Zod schemas, export a factory function that takes an injected dependency
(Octokit, MemoryStore, or nothing), and return a `Record<string, ToolEntry>`. All nine tools
from the architecture spec are implemented. `buildRegistry()` in `context.ts` spreads them together.
The factory pattern keeps tools testable without hitting real APIs.

## ✅ What Looks Good

- **Consistent factory pattern** across all three modules — same shape, same export convention.
- **8 KB patch truncation** in `fetch_pr_files` directly implements the architecture guardrail;
  the constant is named and easy to find.
- **Graceful degradation** in `tickets.ts` — returns `{ error: "..." }` rather than throwing when
  `LINEAR_API_KEY` is absent. Agents see an error-as-data response, same as a tool failure.
- **`createOctokit()` validates `GITHUB_TOKEN`** at instantiation time (throws early) rather than
  letting a missing token produce a cryptic 401 at call time.
- **Local `LinearClient` interface** in `tickets.ts` documents exactly which SDK surface we rely on.
  If the Linear SDK changes, the interface will catch it at compile time.
- **Test isolation is clean** — `mockOctokit()` and `mockStore()` factories produce fresh mocks per
  test; no shared state leaking between cases.
- **`jest.mock('@octokit/rest')`** at the top of the GitHub test file is the right fix for the
  ESM-only Octokit dependency; the rationale comment will save the next person time.

## 📋 Ticket Alignment

- [x] `fetch_pr_diff` — implemented in `github.ts`
- [x] `fetch_pr_comments` — implemented in `github.ts`
- [x] `fetch_pr_files` — implemented in `github.ts`, 8 KB truncation guardrail active
- [x] `post_review_comment` — implemented in `github.ts`, DRY_RUN gated
- [x] `search_past_reviews` — implemented in `memory.ts`
- [x] `store_review` — implemented in `memory.ts`
- [x] `create_memory` — implemented in `memory.ts`
- [x] `fetch_ticket` (Linear adapter) — implemented in `tickets.ts`
- [x] `search_tickets` — implemented in `tickets.ts`
- [x] All tools wired into `buildRegistry()` in `context.ts`

## 🔴 Blocking Issues

### 1. `DRY_RUN` read at module load time — env var changes after import are silently ignored

**File:** `src/tools/github.ts`, line 34

```typescript
const DRY_RUN = process.env.DRY_RUN === 'true'  // ← evaluated once at import
```

Because this is a module-level constant, changing `process.env.DRY_RUN` after the module is
imported (e.g. in tests, or via a runtime config change) has no effect. The test even acknowledges
this with a comment: *"DRY_RUN is read at module load time, so we test via the factory by checking
the guard logic directly"* — which means the actual dry-run path (`dryRun: true` branch) is **never
tested**.

**Fix:** Read the env var inside the handler at call time:

```typescript
fn: async ({ owner, repo, pull_number, body }) => {
  if (process.env.DRY_RUN === 'true') {
    return { dryRun: true, message: 'DRY_RUN=true — comment not posted', body }
  }
  // ...
}
```

This unblocks writing a proper test for the dry-run branch without module-load-time gymnastics.

### 2. Stale comment in `context.ts` contradicts the implementation

**File:** `src/harness/context.ts`, lines 40–47

The comment block above `buildRegistry()` says *"For now it returns an empty registry so the rest
of the composition plumbing can be exercised end-to-end before tools exist"* — but the function
body now fully populates the registry. Left as-is it will confuse anyone reading the file.

**Fix:** Delete or update the comment to reflect the current state.

## ⚠️ Suggestions

### A. `teamKey` in `SearchTicketsSchema` is accepted but silently unused

**File:** `src/tools/tickets.ts`, lines 12–14

`teamKey` is a valid schema field but the `issueSearch` call in the implementation ignores it
entirely. The agent might pass a `teamKey` expecting scoped results and get unscoped results back
with no indication of the mismatch.

Two options: (1) remove `teamKey` from the schema until it's wired, or (2) add a comment saying
it's reserved for future use.

### B. `fetch_pr_files` and `fetch_pr_comments` silently cap at 100 items

**File:** `src/tools/github.ts`, lines 64, 86

Both tools pass `per_page: 100` with no pagination loop. For the demo target (a small PR) this is
fine, but a PR with >100 review comments or >100 changed files will silently return a truncated
set. GitHub's files endpoint actually caps at 300 total; the list-comments endpoint does paginate.

Suggest adding a comment next to `per_page: 100` that reads `// MVP: no pagination; sufficient for
demo target` so the limitation is explicit and searchable.

### C. `fetch_pr_diff` double-cast is unexplained

**File:** `src/tools/github.ts`, line 51

```typescript
return { diff: data as unknown as string }
```

This works because Octokit returns the raw diff body as a string when `mediaType: { format: 'diff' }`
is requested — but the TypeScript types don't reflect the custom media type override, so the cast is
necessary. A one-line comment would make this obviously intentional rather than obviously wrong.

### D. `require()` in `buildRegistry()` is a workaround that deserves a ticket

**File:** `src/harness/context.ts`, lines 49–52

The lazy `require('../tools/github')` works but breaks TypeScript's static analysis at that call
site — the return types of `createGithubTools` and `createOctokit` are inferred as `any`. The root
cause is Octokit's ESM-only distribution conflicting with Jest's CJS runtime. A proper fix (adding
`@octokit/rest` to `transformIgnorePatterns` with Babel's ESM transform, or switching to
`jest.unstable_mockModule`) is non-trivial but worth a follow-up ticket.

## ❓ Questions

1. The architecture spec mentions `search_codebase` (code index / vector search) as a tenth tool.
   It's absent here — intentional skip for the MVP? The `MemoryStore.searchCode()` method exists
   but is never exposed as a tool.

2. `post_review_comment` posts to `issues.createComment` (a PR-level comment), not
   `pulls.createReviewComment` (a line-level inline comment). Is a general PR comment sufficient
   for the demo, or do we want line-level inline suggestions?

## Testing Recommendations

- After fixing blocking issue #1, add a test that sets `process.env.DRY_RUN = 'true'` before
  calling `post_review_comment.fn` and asserts `dryRun: true` comes back (no API call made).
- Add a test for `fetch_pr_diff` that verifies the `{ diff: ... }` wrapper shape.
- Consider a smoke test for `fetch_ticket` with a mocked `@linear/sdk` to cover the happy path.

---

## Verdict

**Request Changes (minor — 2 items, both quick fixes)**

The tool layer is well-structured and the factory/injection pattern is consistent with the rest of
the codebase. Two things need fixing before merge: the `DRY_RUN` env var must be read at call time
(the current version makes it untestable and brittle in production), and the stale comment in
`context.ts` should be updated. Everything else is suggestion-level.
