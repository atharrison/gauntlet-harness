# PR Review — FIR-7: Live Activity Feed + Pipeline Stage Tracker

**PR:** https://github.com/atharrison/gauntlet-harness/pull/8  
**Branch:** `fir-7/demo-polish-activity-feed`  
**Author:** atharrison  
**Reviewer:** Andrew Harrison  
**Date:** 2026-06-13

---

## 📂 File Coverage

3 files changed. All 3 read in full.

| File                                    | Status                  |
| --------------------------------------- | ----------------------- |
| `app/review/[id]/ReviewShell.tsx`       | ✅ Read                 |
| `src/agents/pr-review/context-agent.ts` | ✅ Read                 |
| `src/agents/pr-review/coordinator.ts`   | ✅ Read (1-line change) |

---

## Overview

Replaces the static "Event Log" text sidebar with two interactive widgets: a four-stage pipeline tracker (with per-stage spinner/checkmark and elapsed timer) and a scrolling activity feed that surfaces every context-agent tool call in real time. On the server side, `context-agent.ts` wraps its dispatcher to emit a `progress` SSE event before each tool call. Clean approach overall — the UX improvement is real. One logic bug in the DOMAIN phase transition will cause it to advance too early in practice.

---

## ✅ What Looks Good

- Wrapping the dispatcher in `context-agent.ts` is minimal and surgical — no changes to `loop.ts` or `tools.ts`, pure decorator pattern.
- `PhaseRow` / `PhaseIcon` extracted as small pure components — easy to extend.
- Auto-scroll with `activityEndRef` is the correct pattern for a live log.
- Elapsed timer correctly cleans up on status change (clearInterval in the effect return).
- `addActivity` using a functional updater means entries are never dropped under concurrent renders.
- `formatTool` gives human-readable names without leaking internal tool names to the UI.
- The `emit` param on `ContextAgentOptions` is optional (`emit?`) so existing test callers don't need changes.

---

## 🔴 Blocking Issues

### 1. DOMAIN phase transitions on the _first_ agent completion, not the second

**File:** `app/review/[id]/ReviewShell.tsx`, lines 147–158

```typescript
} else if (data.stage === 'DOMAIN') {
  const agentName = data.agentName as string
  addActivity({ type: 'phase', text: `✓ ${agentName} agent complete` })
  setActivity(prev => {
    const domainCount =
      prev.filter(a => a.text.includes('agent complete')).length + 1
    if (domainCount >= 2) {
      setPhaseStatuses(p => ({ ...p, DOMAIN: 'done', OUTPUT: 'running' }))
    }
    return prev
  })
}
```

**The bug:** React 18 automatic batching processes all state-updater functions enqueued in the same synchronous block in order before any re-render. `addActivity` itself calls `setActivity(prev => [...prev, entry])`. When the immediately following `setActivity(prev => { ... count ... })` runs, its `prev` is the _post-addActivity_ state — the entry saying `"✓ correctness agent complete"` is already in `prev`. So on the very first DOMAIN checkpoint:

```
prev.filter(a => a.text.includes('agent complete')).length  →  1 (just added)
1 + 1 = 2  →  >= 2  →  DOMAIN: done, OUTPUT: running  ← fires too early
```

DOMAIN is marked done the moment the _first_ agent finishes. In the demo, both agents finish within a second of each other so it's hard to notice, but the pipeline widget will briefly show DOMAIN ✓ while one agent is still running.

**Secondary problem:** Calling `setPhaseStatuses(...)` _inside_ a `setActivity` updater function is a React anti-pattern. Updater functions must be pure (no side effects). React StrictMode double-invokes updaters to detect this — so `setPhaseStatuses` would be called twice per checkpoint in dev mode.

**Fix:** Track domain completions in dedicated state, not by scanning activity text:

```typescript
// Add alongside other state declarations:
const domainDoneRef = useRef(0)

// In the DOMAIN branch of the checkpoint handler:
} else if (data.stage === 'DOMAIN') {
  const agentName = data.agentName as string
  addActivity({ type: 'phase', text: `✓ ${agentName} agent complete` })
  domainDoneRef.current += 1
  if (domainDoneRef.current >= 2) {
    setPhaseStatuses(p => ({ ...p, DOMAIN: 'done', OUTPUT: 'running' }))
    addActivity({ type: 'phase', text: '✓ Both domain agents done — generating summary' })
  }
}
```

Using a `ref` (not state) for the counter avoids a re-render and sidesteps the batching issue entirely since refs are mutated synchronously.

---

## ⚠️ Suggestions

### 2. Module-level `activitySeq` should be a `useRef`

**File:** `ReviewShell.tsx`, line 51

```typescript
let activitySeq = 0
```

This is a module-level mutable variable. It works, but:

- It's shared across all component instances (shouldn't matter here since there's one per page, but it's unexpected)
- It doesn't reset on hot-module reload in dev
- It increments in React StrictMode's double-invoke of `addActivity`'s updater, so IDs in dev will skip numbers

Idiomatic fix: `const activitySeqRef = useRef(0)` inside the component, then `id: ++activitySeqRef.current` in `addActivity`. If `addActivity` is going to stay a plain function (not a `useCallback`), the ref approach works cleanly.

### 3. Circular type import: `context-agent.ts` ← `coordinator.ts`

**File:** `src/agents/pr-review/context-agent.ts`, line 4

```typescript
import type { ReviewEmitter } from './coordinator'
```

`coordinator.ts` imports `runContextAgent` from `context-agent.ts`. Adding the reverse import creates a cycle. TypeScript resolves type-only circular imports fine, but it's a code smell and can confuse bundlers. `ReviewEmitter` is just `(event: string, data: unknown) => void` — it should live in a shared location like `src/harness/types.ts` or inline in `context-agent.ts` directly:

```typescript
// In context-agent.ts — no import needed
type Emitter = (event: string, data: unknown) => void
```

### 4. Missing `prUrl` in the SSE `useEffect` dependency array

**File:** `ReviewShell.tsx`, line 122

```typescript
useEffect(() => {
  const es = new EventSource(
    `/api/review/${reviewId}?prUrl=${encodeURIComponent(prUrl)}`
  )
  ...
}, [reviewId])  // ← prUrl is used but not listed
```

`prUrl` won't change for a given review page, so this is functionally safe today. But if Next.js ever enables the `react-hooks/exhaustive-deps` ESLint rule (it's off by default in the Next.js config), this will flag. Add `prUrl` to the dep array to be correct:

```typescript
}, [reviewId, prUrl])
```

### 5. Unsafe `as string` cast for `agentName`

**File:** `ReviewShell.tsx`, line 148

```typescript
const agentName = data.agentName as string
```

If the server ever emits a DOMAIN checkpoint without `agentName` (e.g., an error path), `agentName` silently becomes `undefined`, and the activity entry reads `"✓ undefined agent complete"`. Prefer:

```typescript
const agentName =
  typeof data.agentName === 'string' ? data.agentName : 'unknown'
```

### 6. Auto-scroll fights the user's scroll position

**File:** `ReviewShell.tsx`, lines 113–116

```typescript
useEffect(() => {
  activityEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [activity])
```

This fires on _every_ activity update. If the user scrolls up to re-read an earlier entry, the next tool call (which arrive every few seconds during the context phase) will snap them back to the bottom. Consider only auto-scrolling if the user is already near the bottom:

```typescript
useEffect(() => {
  const el = activityEndRef.current
  if (!el) return
  const parent = el.parentElement
  if (!parent) return
  const nearBottom =
    parent.scrollHeight - parent.scrollTop - parent.clientHeight < 60
  if (nearBottom) el.scrollIntoView({ behavior: 'smooth' })
}, [activity])
```

---

## ❓ Questions

1. The `progress` event fires _before_ the tool call executes (emit then dispatch). Should it fire after, so the activity log shows "fetched X" rather than "fetching X…"? The current "fetching…" wording implies in-progress, which is arguably better UX — just confirming this was intentional.

2. `fetch_pr_comments` is listed in the GitHub tools but not in `formatTool`. If the context agent ever calls it, the label will fall through to the default (`fetch pr comments…`). Worth adding an explicit case.

---

## Testing Recommendations

- [ ] Trigger a review and verify DOMAIN doesn't transition to "done" until the second agent checkpoint arrives (requires the fix in issue #1)
- [ ] Open DevTools and verify no "Cannot update a component while rendering a different component" warnings in the console (symptom of the `setPhaseStatuses` inside `setActivity` issue)
- [ ] In dev mode (StrictMode active): confirm activity IDs don't have unexpected gaps (module-level `activitySeq` issue)
- [ ] Manually scroll up in the activity feed mid-review; confirm the next event doesn't hijack your scroll position back to the bottom (after fix #6)

---

## Verdict

**Request Changes** — one fix required before merge

The DOMAIN phase-counting logic (issue #1) is a genuine bug with a clean, simple fix. Everything else is suggestions/nits. Once #1 is addressed with a `useRef` counter, this is good to merge. The UX improvement is real and the activity feed genuinely makes the review feel alive.
