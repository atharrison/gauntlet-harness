# PR Review — FIR-6: Multi-Agent PR Review Pipeline

**PR:** https://github.com/atharrison/gauntlet-harness/pull/6
**Branch:** `ath/FIR-6/task-1`
**Author:** atharrison
**Reviewer:** Andrew Harrison
**Date:** 2026-06-13

---

## 📂 File Coverage

16 files changed. 14 read in full, 2 legitimately skipped.

| File                                        | Status                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `src/agents/pr-review/prompts.ts`           | ✅ Read                                              |
| `src/agents/pr-review/context-agent.ts`     | ✅ Read                                              |
| `src/agents/pr-review/coordinator.ts`       | ✅ Read                                              |
| `src/agents/pr-review/correctness-agent.ts` | ✅ Read                                              |
| `src/agents/pr-review/security-agent.ts`    | ✅ Read (identical structure to correctness-agent)   |
| `src/agents/pr-review/merge.ts`             | ✅ Read                                              |
| `src/agents/pr-review/approval.ts`          | ✅ Read                                              |
| `src/harness/models.ts`                     | ✅ Read                                              |
| `src/harness/loop.ts`                       | ✅ Read                                              |
| `app/api/review/[id]/route.ts`              | ✅ Read                                              |
| `app/review/[id]/ReviewShell.tsx`           | ✅ Read                                              |
| `tests/merge.test.ts`                       | ✅ Read                                              |
| `tests/approval.test.ts`                    | ✅ Read                                              |
| `tests/coordinator.test.ts`                 | ✅ Read                                              |
| `.gitignore`                                | ✅ Read                                              |
| `tsconfig.tsbuildinfo`                      | ⬜ Skipped (deleted build artifact — correct action) |

---

## 🎫 Ticket Context

**FIR-6**: Multi-agent PR review pipeline
Implement the full agent layer: context agent, parallel domain agents (correctness + security), finding merge/dedup, coordinator orchestration, and a shared approval state machine.

## Overview

This PR delivers the core intelligence of the harness — replacing every stub with working agents. The architecture is clean: a tool-calling context agent gathers the PR diff and ticket info, two single-shot domain agents run in parallel, a merge pass deduplicates and calibrates confidence, and a coordinator writes checkpoints and streams progress over SSE. The approval state machine and GitHub comment formatter round out the web-to-PR handoff. This is solid, well-structured work.

---

## ✅ What Looks Good

- **Graceful degradation everywhere** — both context-agent and domain agents fall back to empty/minimal results on JSON parse failure rather than throwing. The SSE route catches all errors and emits them as `error` events before closing. Nothing crashes silently.
- **`Promise.all` fan-out** — correctness and security agents run in parallel with no shared state. Clean.
- **`systemPrompt` threading** — adding it as an optional third param to `ModelClient.chat()` is backward-compatible, and using the Anthropic SDK's top-level `system` field (rather than prepending to the message array) is the right approach.
- **Prompt discipline** — each agent system prompt explicitly lists what it should NOT review (`Do NOT comment on style, naming, security...`). This reduces cross-domain hallucinations.
- **Merge algorithm** — the three-part dedup signal (same file + line proximity + title word overlap) is well-reasoned, and the ×0.9 confidence penalty for uncorroborated findings is a nice calibration touch.
- **Approval state machine** — pure functions with no side effects, easily testable, works for both web and CLI.
- **Test quality** — coordinator tests mock the model's call sequence explicitly, which documents the expected call order; merge tests verify dedup doesn't trigger on different files or distant lines.

---

## 📋 Ticket Alignment

- [x] `prompts.ts` — system prompts + domain instruction blocks
- [x] `context-agent.ts` — full tool-calling loop, produces `EnrichedContext`
- [x] `correctness-agent.ts` — single-shot structured output
- [x] `security-agent.ts` — single-shot structured output
- [x] `merge.ts` — dedup, calibrate, sort
- [x] `coordinator.ts` — orchestrate phases, `Promise.all` fan-out, checkpoint writes
- [x] `approval.ts` — shared state machine (CLI + web)
- [x] SSE route wired to real `runReview()` call

---

## 🔴 Blocking Issues

### Finding IDs in SSE events don't match merged PRReview

**File:** `coordinator.ts` lines 89–100 and `merge.ts` lines 43–61

Domain agents emit `finding` events _before_ the merge step. After merge, duplicate findings are collapsed and one ID is dropped. The `ReviewShell` builds its decision map from the SSE `finding` events, but the final `PRReview` stored at the OUTPUT checkpoint contains the _merged_ findings with a subset of those IDs.

When the user submits decisions, `formatGitHubComment` builds a `byId` map from `review.blockingIssues/suggestions/nits`. Any decision referencing a finding ID that was deduped away silently produces no output. Worse — the finding that _was_ kept may have no decision if the user only acted on the dropped duplicate.

**Fix:** Emit `finding` events after Phase 3 (merge), not during Phase 2:

```typescript
// Phase 2 — just collect results, no emit
const [correctnessResult, securityResult] = await Promise.all([
  runCorrectnessAgent({ enrichedContext, model: deps.model }).then(r => {
    emit('checkpoint', {
      stage: 'DOMAIN',
      agentName: 'correctness',
      status: 'PASS',
      reviewId,
    })
    return r
  }),
  runSecurityAgent({ enrichedContext, model: deps.model }).then(r => {
    emit('checkpoint', {
      stage: 'DOMAIN',
      agentName: 'security',
      status: 'PASS',
      reviewId,
    })
    return r
  }),
])

// Phase 3 — emit merged findings
const mergedFindings = mergeResults([correctnessResult, securityResult])
mergedFindings.forEach(f => emit('finding', { finding: f }))
```

---

## ⚠️ Suggestions

### `buildSubmission` comment is wrong

**File:** `approval.ts` line 94–95

```typescript
/**
 * Build the final ReviewSubmission from the current approval state.
 * Filters out REJECT decisions so only accepted/edited findings are included.
 */
```

`buildSubmission` includes _all_ decisions (`Object.values(state.decisions)`) — REJECTs too. `formatGitHubComment` correctly filters to `d.action !== 'REJECT'` itself. The comment is misleading; update it to say "includes all decisions; the caller is responsible for filtering REJECTs."

---

### `toggleDecision` collapses EDIT state

**File:** `approval.ts` line 65

```typescript
const next: DecisionAction = current.action === 'ACCEPT' ? 'REJECT' : 'ACCEPT'
```

If a user edits a finding (`action = 'EDIT'`) and then clicks the checkbox, this sends them to `ACCEPT` (losing the edited body). Consider:

```typescript
const next: DecisionAction = current.action === 'REJECT' ? 'ACCEPT' : 'REJECT'
```

This way toggling always moves to REJECT or back to ACCEPT; editing remains a separate explicit action that doesn't get clobbered.

---

### CONTEXT checkpoint `check` always sets `error` field on success

**File:** `coordinator.ts` line 77–82

```typescript
return {
  pass: Boolean(ctx.diff || ctx.filesChanged.length > 0),
  payload: ctx,
  error: 'Context agent returned empty diff and no files', // ← always set
}
```

`runCheckpoint` saves `error` into the checkpoint record regardless of `pass`. Every successful CONTEXT checkpoint will have an error string in its payload. Fix:

```typescript
const pass = Boolean(ctx.diff || ctx.filesChanged.length > 0)
return {
  pass,
  payload: ctx,
  error: pass ? undefined : 'Context agent returned empty diff and no files',
}
```

---

### `mode` query param is cast, not validated

**File:** `app/api/review/[id]/route.ts` line 24

```typescript
const mode = (searchParams.get('mode') ?? 'full') as 'full' | 'quick'
```

A type cast isn't input validation. `?mode=anything` passes through. A one-liner fix:

```typescript
const rawMode = searchParams.get('mode')
const mode: 'full' | 'quick' = rawMode === 'quick' ? 'quick' : 'full'
```

---

### Domain agent failures aren't checkpointed as FAIL

**File:** `coordinator.ts` lines 89–100

If `runCorrectnessAgent` or `runSecurityAgent` throws (e.g., Anthropic API timeout), the `Promise.all` rejects and the coordinator's outer `try/catch` in the SSE route catches it and emits an `error` SSE event. But no DOMAIN FAIL checkpoint is written. The checkpoint record will simply be absent for that agent, which is ambiguous when inspecting a failed run. Consider wrapping each domain agent call in `runCheckpoint` (as done for CONTEXT).

---

## ❓ Questions

1. **Quick mode and empty diff** — In `mode=quick`, `EnrichedContext.diff` is `''`. Domain agents receive an empty context and can only speculate. Is quick mode intended to be used with a pre-built context injected some other way, or is it purely a "speed over accuracy" trade-off?

2. **InMemoryCheckpointStore in production** — `createReviewContext()` in the SSE route uses `InMemoryCheckpointStore`. Is the Supabase checkpoint store wired in FIR-8? If a review crashes and the user refreshes, there's currently no way to resume from the last successful checkpoint.

3. **`externalContextCalls` accounting** — The context agent adds `result.turnsUsed` to `parsed.externalContextCalls`. Is `turnsUsed` the right proxy here, or should it be the number of distinct tool calls (which could differ if multiple calls happen per turn)?

---

## Testing Recommendations

- **Manually trigger a review** with a real PR URL and confirm SSE `finding` events carry IDs that match the final PRReview (critical given the blocking finding above).
- **Edit a finding, then toggle the checkbox** — verify the edited body is preserved (or intentionally lost, per decision on the `toggleDecision` fix).
- **Pass `?mode=invalid` to the SSE route** — verify it defaults to `"full"` rather than behaving unexpectedly.
- **Kill the Anthropic API mid-review** (or pass a bad key) — verify the SSE `error` event fires and the stream closes cleanly.

---

## Verdict

**Request Changes** (one blocking, rest are easy fixes)

The architecture is excellent and the implementation is solid. One structural issue needs fixing before merge: SSE finding events must be emitted _after_ the merge step so that the finding IDs the client builds decisions against match the IDs in the final `PRReview`. The other items are quick one-liners.
