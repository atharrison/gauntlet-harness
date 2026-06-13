# Harness Design — PR Review Agent

**Gauntlet Hackathon (Fired Festival) · 2026-06-13**

Live deployment: https://gauntlet-review-harness.up.railway.app  
Repo: https://github.com/atharrison/gauntlet-harness

---

## What It Does

Paste a GitHub PR URL. Five specialized agents review it in parallel. You curate the findings — accept, reject, or edit each one — before anything reaches your team. The system gets smarter with each review: past reviews and team standards are injected as context automatically.

```
Browser → POST /api/review/start
       → GET  /api/review/[id]        (SSE stream — live agent progress)
       → /review/[id]                 (approval UI — finding cards, checkbox, inline edit)
       → POST /api/review/[id]/finalize → Supabase history + optional GitHub PR comment
```

---

## The Four Pillars

### 1. Guardrails

**Where:** `src/harness/guardrails.ts`, `src/harness/tools.ts`

Guardrails enforce correctness and safety at two layers:

**Input guardrails** — before the agents run:
- PR size gate: warns when a PR exceeds `PR_MAX_FILES` (default 50) or `PR_MAX_LINES` (default 3000) — fires `PR_TOO_LARGE` alarm, agents still run but reviewer is informed
- `prUrl` required — SSE stream returns `error` event immediately if absent

**Tool dispatch guardrail** — during the agent loop:
- Every tool call flows through `dispatch()` in `src/harness/tools.ts` — no agent calls a tool directly
- `dispatch()` enforces an **allow-list**: unknown tool names return error-as-data, never execute
- **Zod argument validation**: every tool has a typed `schema`; malformed args are rejected before the function is called
- **Tool timeout**: each call is wrapped in `withTimeout()` — fires `TOOL_TIMEOUT` alarm and returns error-as-data after 30s; agent loop continues
- **Read-only enforcement**: GitHub and ticket tracker tools are read-only by construction. `post_review_comment` (the only write) is excluded from the agent registry — it only runs after the reviewer explicitly submits finalize with `postComment: true`

**Output guardrails** — after agents produce findings:
- `validateReviewOutput()` runs three checks on every `PRReview` before it reaches the UI:
  1. **Zod schema validation** — `PRReviewSchema.safeParse()` — rejects structurally invalid output
  2. **File citation check** — every finding must reference a file actually in the PR diff; hallucinated filenames fire `HALLUCINATED_FILE_CITATION` alarm and are stripped
  3. **Secret scan** — regex patterns for OpenAI/Anthropic keys, GitHub tokens, AWS access keys, JWTs, PEM keys, Slack tokens — fires `SECRET_DETECTED` alarm if any match
- `DRY_RUN=true` env var suppresses all writes to GitHub (safe for dev/demo)

---

### 2. Checkpoints

**Where:** `src/harness/checkpoints.ts`, `src/agents/pr-review/coordinator.ts`

Every review runs through five named checkpoint stages. Each stage has a defined pass/fail criterion, persists its result to Supabase, and fires an alarm on failure.

| Stage | What it checks | Pass criterion |
|---|---|---|
| `INPUT` | `prUrl` is present and well-formed | `Boolean(prUrl)` |
| `CONTEXT` | Context Agent produced usable diff/files | `diff` non-empty OR `filesChanged.length > 0` |
| `DOMAIN` | Each domain agent (correctness, security) completed | Agent returned a `DomainResult` without throwing |
| `OUTPUT` | Final `PRReview` passes Zod schema | `PRReviewSchema.safeParse()` succeeds |
| `FINALIZE` | Reviewer submitted decisions; memory store write attempted | Decisions present and non-empty |

**Implementation:**

```typescript
// runCheckpoint() is generic — same function for every stage
await runCheckpoint({
  reviewId,
  stage: 'CONTEXT',
  store: deps.checkpoints,
  check: async () => {
    const ctx = await runContextAgent({ prUrl, reviewId, context })
    return { pass: Boolean(ctx.diff || ctx.filesChanged.length > 0), payload: ctx }
  },
})
```

On `PASS`: persists the record to `review_checkpoints` in Supabase and returns the payload.  
On `FAIL`: persists the FAIL record, fires `CHECKPOINT_FAILED` alarm (severity: `HIGH`), and throws `CheckpointFailedError`.

The checkpoint records give a complete audit trail: what each agent received as input, whether it passed, and when. This is the foundation for a future "resume from checkpoint" capability (already stubbed as `resumeFromCheckpoint()`).

---

### 3. Material Handling

**Where:** `src/harness/tools.ts`, `src/tools/github.ts`, `src/tools/memory.ts`, `src/tools/tickets.ts`, `src/harness/context.ts`

"Material handling" means getting the right information to the right agent at the right time — with typed contracts, not ad-hoc string passing.

**Tool registry pattern:**

All tools share a single interface:
```typescript
interface ToolEntry<TInput = unknown> {
  fn: (input: any) => Promise<unknown>  // dispatch validates via Zod before calling
  schema: z.ZodType<TInput>             // Zod schema for arg validation
  description: string                   // passed verbatim to the model
}
```

Tools are registered at startup in `createReviewContext()` via `buildRegistry()`, which spreads all tool factories (GitHub, memory, ticket) into a single `ToolRegistry`. Factories return empty `{}` when their credentials are absent — **graceful degradation**: the model simply doesn't see tools it can't use.

**Typed tool definitions:** `toToolDefinitions()` converts `ToolRegistry` → `ToolDefinition[]` (the format the Anthropic API expects) by walking each tool's Zod schema. No manual JSON schema authoring.

**Information flow:**
1. Context Agent (full tool-calling loop) → `EnrichedContext` — assembles PR diff, changed files, ticket context, past review summaries
2. `EnrichedContext` is passed verbatim to both domain agents — single source of truth, no re-fetching
3. Domain agents return `DomainResult[]` → `mergeResults()` deduplicates by file+line proximity and applies a 0.9× confidence penalty to findings corroborated by only one agent
4. `PRReview` (Zod-validated) → in-process TTL cache → finalize route

**Pluggable by design:**

| Layer | Default | Swap via |
|---|---|---|
| LLM | Anthropic Claude | `LLM_PROVIDER=openai` |
| Ticket tracker | Linear | `TicketClient` interface |
| Memory store | Supabase | `MEMORY_PROVIDER=sqlite` for CLI |
| Git host | GitHub | `OctokitClient` interface |

No harness-core code imports from Anthropic, GitHub, or Supabase directly. All external dependencies are behind interfaces and injected via `createReviewContext()`.

---

### 4. Alarms

**Where:** `src/harness/alarms.ts`

Alarms are the observability backbone — named, structured alerts that fire at known risk points throughout the pipeline.

**Alarm anatomy:**
```typescript
interface Alarm {
  type: AlarmType           // named enum — no magic strings
  severity: AlarmSeverity   // LOW | MEDIUM | HIGH | CRITICAL
  message: string
  context: Record<string, unknown>
  reviewId?: string
  recommendedAction: string // actionable guidance for the operator
  timestamp: string
}
```

**All alarm types with severity:**

| AlarmType | Severity | Fires when |
|---|---|---|
| `TURN_LIMIT_EXCEEDED` | HIGH | Agent loop hit `maxTurns` without a final answer |
| `TOKEN_LIMIT_EXCEEDED` | HIGH | Cumulative token count crossed `maxTokens` |
| `TIMEOUT_EXCEEDED` | HIGH | Agent loop ran past `timeoutMs` |
| `TOOL_TIMEOUT` | MEDIUM | Single tool call exceeded 30s |
| `REPEATED_TOOL_CALL` | MEDIUM | Same tool called with identical args 3× in a row |
| `CHECKPOINT_FAILED` | HIGH | A named pipeline stage produced a FAIL result |
| `SCHEMA_VALIDATION_FAILED` | HIGH | Final output failed `PRReviewSchema.safeParse()` |
| `HALLUCINATED_FILE_CITATION` | MEDIUM | Finding references a file not in the PR diff |
| `SECRET_DETECTED` | CRITICAL | Credential-shaped string found in review output |
| `PR_TOO_LARGE` | LOW | PR exceeded `PR_MAX_FILES` or `PR_MAX_LINES` thresholds |

**Alarm delivery:** `fireAlarm()` writes structured JSON to `stderr` (always) and optionally calls a registered SSE emitter so the browser event log receives live alarm notifications. The SSE `alarm` event type is handled in `ReviewShell.tsx`.

**Instrumentation with OpenTelemetry:** every significant operation emits an OTel span via `tracedModelCall()` in `src/harness/observability.ts`. Signals tracked: `files_read/files_in_pr`, `$/review`, `findings_accepted/total`, `turns_used/turns_max`, `tool_errors`. These are designed to answer the questions a reviewer actually cares about — not generic agent telemetry.

---

## Multi-Agent Architecture

```
                    Context Agent
               (full loop · up to 15 turns)
                fetch diff → fetch files → search memory → output EnrichedContext
                          ↓
           ┌──────────────┴──────────────┐
           ▼                             ▼
   Correctness Agent             Security Agent
   (single-shot structured)      (single-shot structured)
   DomainResult                  DomainResult
           └──────────────┬──────────────┘
                          ↓
                   mergeResults()
           dedup by file+line proximity
           confidence calibration
           BLOCKING → SUGGESTION → NIT sort
                          ↓
               Coordinator summary call
               (PRReview Zod-validated)
                          ↓
                    Approval UI
           accept / reject / edit per finding
                          ↓
              finalize → Supabase + GitHub
```

**Quick mode** (`?mode=quick`): skips the Context Agent entirely, feeds the raw PR URL to Correctness + Security only, surfaces `BLOCKING` findings in ~30 seconds.

---

## Repo Map

```
src/
  harness/
    alarms.ts          — AlarmType enum, fireAlarm(), OTel integration
    checkpoints.ts     — runCheckpoint(), CheckpointStore interface
    context.ts         — createReviewContext() composition root
    guardrails.ts      — input/output integrity checks, secret scan
    loop.ts            — agent loop: maxTurns, maxTokens, timeoutMs hard stops
    models.ts          — ModelClient interface + Anthropic adapter
    observability.ts   — OTel tracer, tracedModelCall(), coverage signals
    review-cache.ts    — in-process TTL Map bridges SSE route → finalize route
    tools.ts           — ToolRegistry, dispatch(), toToolDefinitions()
  agents/pr-review/
    context-agent.ts   — full tool-calling loop → EnrichedContext
    correctness-agent.ts — single-shot structured output
    security-agent.ts    — single-shot structured output
    coordinator.ts     — orchestrate phases, checkpoint writes, SSE emit
    merge.ts           — dedup, confidence calibration, sort
    approval.ts        — shared approval state machine (web + CLI)
    prompts.ts         — system prompts + domain instruction blocks
    schema.ts          — Zod schemas: Finding, EnrichedContext, PRReview, …
  memory/
    store.ts           — MemoryStore interface
    supabase.ts        — SupabaseMemoryStore (team-shared, pgvector-ready)
    local.ts           — LocalMemoryStore (SQLite, CLI fallback)
  tools/
    github.ts          — fetch_pr_diff, fetch_pr_files, fetch_pr_comments
    memory.ts          — search_past_reviews, store_review, create_memory
    tickets.ts         — fetch_ticket, search_tickets (Linear adapter)
app/
  api/review/
    start/route.ts     — mint reviewId, redirect to review page
    [id]/route.ts      — SSE stream (maxDuration=300s)
    [id]/finalize/route.ts — store review, optional GitHub comment
  api/health/route.ts  — Railway health check
  review/[id]/
    ReviewShell.tsx    — SSE client, finding cards, approval UI
tests/                 — 100 passing (Jest + ts-jest)
```

---

## Running It

```bash
# Deployed
open https://gauntlet-review-harness.up.railway.app

# Local dev
cp .env.example .env  # fill in ANTHROPIC_API_KEY, GITHUB_TOKEN
npm install
npm run dev

# Tests
npm test              # 100 unit tests, no external services needed

# Required env vars
ANTHROPIC_API_KEY
GITHUB_TOKEN
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
LINEAR_API_KEY        # optional — ticket context degrades gracefully without it
```
