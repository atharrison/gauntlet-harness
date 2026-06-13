# PR Review — FIR-2: Stream A Harness Core

**PR:** https://github.com/atharrison/gauntlet-harness/pull/2
**Branch:** `ath/FIR-2/task-1`
**Author:** Andrew Harrison
**Reviewer:** Andrew Harrison
**Date:** 2026-06-13

---

## 📂 File Coverage

11 files changed. 11 read in full.

| File                           | Status  |
| ------------------------------ | ------- |
| `src/harness/models.ts`        | ✅ Read |
| `src/harness/loop.ts`          | ✅ Read |
| `src/harness/tools.ts`         | ✅ Read |
| `src/harness/checkpoints.ts`   | ✅ Read |
| `src/harness/guardrails.ts`    | ✅ Read |
| `src/harness/observability.ts` | ✅ Read |
| `tests/models.test.ts`         | ✅ Read |
| `tests/loop.test.ts`           | ✅ Read |
| `tests/tools.test.ts`          | ✅ Read |
| `tests/checkpoints.test.ts`    | ✅ Read |
| `tests/guardrails.test.ts`     | ✅ Read |

---

## Overview

Implements the four harness pillars as distinct, identifiable TypeScript modules. `dispatch()` is a genuine single choke point for all tool calls. `runCheckpoint()` cleanly separates pass/fail criteria from persistence and alarm emission. The loop hard stops are unconditional and each fires a structured `Alarm` before throwing. Tests cover the behaviors judges care about (hard stops, dispatch blocking, guardrail catches).

## ✅ What Looks Good

- `dispatch()` is a true single choke point — allow-list → Zod validation → timeout, nothing can bypass it
- `runCheckpoint()` is well-structured: check fn → persist → alarm → throw, all in one place
- Errors-as-data pattern in `dispatch()` means tool failures return `{ error }` JSON and the model can reason about them
- `stripHallucinatedFindings()` salvage path avoids discarding the whole run on a bad file citation
- Test fixtures (`makeReply`, `makeModel`, `noopDispatch`) are clean and reusable across tests
- `recordApprovalDecision()` as a free quality instrumentation hook from the approval loop is elegant

## 🔴 Blocking Issues (resolved in follow-up commit)

### Dead code in `models.ts` — `anthropicMessages` built and never used

Lines 72–77 built `anthropicMessages` from filtered messages but it was never referenced. The actual array passed to the API was `allMessages` built separately. **Fixed: dead variable removed.**

### Unused `z` import in `guardrails.ts`

`import { z } from "zod"` was present but `z` was never used in the file. **Fixed: import removed.**

### Unused `TokenUsage` import in `observability.ts`

`TokenUsage` was imported but only used indirectly via `ModelReply`. **Fixed: import removed.**

## ⚠️ Suggestions (applied)

### `apiKey: ""` default fails silently

`createModelClient` defaulted to `""` for missing API keys, which would only fail at first API call. **Fixed: throws immediately with a clear message if `apiKey` is falsy.**

## ⚠️ Suggestions (deferred — noted for later)

### `max_tokens: 8192` hardcoded in `AnthropicClient`

Should be a constructor param. Low priority until we tune for specific models.

### Token budget check timing in `loop.ts`

The check fires at the top of the next turn, so actual spend may exceed `maxTokens` by one turn's cost. Acceptable for now; added inline comment to document the behaviour.

### `TOOL_TIMEOUT_MS` parsed at module load time

Makes it impossible to override in tests without mocking env before import. Acceptable for now; real timeouts aren't exercised in unit tests.

## ❓ Open Questions

1. `zodFieldToJsonSchema` doesn't handle `ZodDefault` or `ZodUnion`. Will any actual tool schemas use these? If so, they'll silently produce `{ type: "string" }`.
2. `resumeFromCheckpoint` casts payload to `T` without runtime validation. Worth a Zod parse at the call site when types matter.

---

## Verdict

**Approve** (after follow-up commit addressing blocking issues)

Clean implementation of all four harness pillars. The architecture is sound, the hard stops are real, and the tests cover the right behaviors.
