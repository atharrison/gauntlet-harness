# PR Review — FIR-3: Stream B — Memory Layer

**PR:** https://github.com/atharrison/gauntlet-harness/pull/3
**Branch:** `ath/FIR-3/task-1`
**Author:** Andrew Harrison
**Reviewer:** Andrew Harrison
**Date:** 2026-06-13

---

## 📂 File Coverage

6 files changed. 6 read in full.

| File                                             | Status  |
| ------------------------------------------------ | ------- |
| `src/memory/store.ts`                            | ✅ Read |
| `src/memory/local.ts`                            | ✅ Read |
| `src/memory/supabase.ts`                         | ✅ Read |
| `src/memory/index.ts`                            | ✅ Read |
| `supabase/migrations/20260613_memory_tables.sql` | ✅ Read |
| `tests/memory.test.ts`                           | ✅ Read |

---

## Overview

Implements the `MemoryStore` abstraction layer with two adapters (SQLite for CLI, Supabase for web), a factory function, shared types, and a Supabase migration. The interface-first design is clean and matches the architecture doc. 6/6 tests passing.

---

## ✅ What Looks Good

- `MemoryStore` interface is lean and well-matched to the three memory types in the architecture
- `SupabaseMemoryStore` accepts an injected `SupabaseClient` — makes it testable without global state
- `LocalMemoryStore` accepts an optional path — temp-file pattern in tests is clean
- WAL mode + foreign keys enabled on SQLite — right defaults
- Migration includes all three tables, RLS enabled, sensible indexes
- `searchCode()` v2 stub is clearly documented on both adapters
- `require("fs")` workaround was caught and fixed during development — good self-correction

---

## 🔴 Blocking Issues

### 1. `review_checkpoints` UNIQUE constraint will break parallel domain agents

**File:** `supabase/migrations/20260613_memory_tables.sql` (line 46)

```sql
UNIQUE (review_id, stage)
```

The `DOMAIN` checkpoint stage is written by both `correctness-agent` and `security-agent` in parallel (FIR-6). With this constraint, the second agent to write will get a unique violation.

The `InMemoryCheckpointStore` key already accounts for this: `${reviewId}:${stage}:${agentName}`. The migration needs to match:

```sql
UNIQUE (review_id, stage, agent_name)
```

And add `agent_name TEXT` as a nullable column so single-agent stages (INPUT, OUTPUT, FINALIZE) still work.

### 2. `rawJson` type mismatch: interface says `string`, Supabase returns an object

**File:** `src/memory/store.ts` (line 18), `src/memory/supabase.ts` (line 101)

`ReviewRecord.rawJson` is typed as `string`. In `supabase.ts`, we store it via `JSON.stringify(review)`, but Supabase stores it as `JSONB` and returns it as a parsed JS object — not a string. Any downstream `JSON.parse(record.rawJson)` call will silently double-parse or throw.

Fix: type `rawJson` as `unknown` (since it's opaque), or change the column to `TEXT` in the migration if you want string-only semantics.

---

## ⚠️ Suggestions

### Dead `openDb()` function in `local.ts`

`openDb()` (lines 20–30) is defined but never called. The constructor inlines the same logic. Remove it.

### `require("fs")` should be a top-level import

Lines 22 and 62 use `const { mkdirSync } = require("fs")` inside functions. This works but is inconsistent with the rest of the file's top-level imports. Replace with `import { mkdirSync } from "fs"` at the top.

### `INSERT OR REPLACE` intent is misleading

`storeReview` in `local.ts` uses `INSERT OR REPLACE` but always generates a new `randomUUID()` for the ID. Since the primary key is always new, the `OR REPLACE` never fires — it's always an INSERT. If the intent is append-only (which is correct for review history), just use `INSERT INTO`.

### `createMemory` has no `context` param — scoped memories unreachable

`MemoryStore.createMemory(content, tags)` has no `context` argument, so all memories are global. The migration and architecture both describe repo-scoped memories. Add an optional third arg: `createMemory(content: string, tags: string[], context?: string): Promise<void>`.

### No test for `SupabaseMemoryStore`

The Supabase adapter has no coverage. Worth adding a minimal mock test that passes an in-memory Supabase client stub to verify the query shape and error propagation — at least for `getMemories` and `searchReviews`.

---

## ❓ Open Questions

1. The `.or()` filter in `getMemories`: `.or(`context.eq.,context.eq.${context}`)` — does PostgREST handle empty-string equality correctly here? What happens if `context` contains a comma or special character (e.g. a repo name like `org/repo,other`)?

2. Should `close()` be on the `MemoryStore` interface as an optional method? Currently `LocalMemoryStore` has it but `SupabaseMemoryStore` doesn't, and callers have to type-check before calling it.

---

## Verdict

**Request Changes** (two blocking issues, then approve)

The abstraction design is solid and the factory pattern is right. Two things need fixing before merge: the checkpoint unique constraint (will cause a hard failure when parallel agents hit the same stage) and the `rawJson` type mismatch (silent data corruption risk). The suggestions are all cleanup items that can land in a follow-up.
