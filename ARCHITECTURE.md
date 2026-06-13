# Gauntlet Harness — Architecture

A standalone, open-source CLI tool for AI-assisted PR review. Built on a
four-pillar harness (Loop, Tools, Guardrails, Observability) with a persistent
memory layer. Downloadable and usable by any engineer on any stack — no
team-specific assumptions baked in.

See [PROMPT_NOTES.md](PROMPT_NOTES.md) for the conceptual framing of each pillar.

---

## System Overview

```
┌────────────────────────────────────────────────────────────┐
│                      Memory Store                          │
│  ┌──────────────────┐  ┌───────────────┐  ┌────────────┐  │
│  │   Code Index     │  │ Review History │  │  Memories  │  │
│  │  (vector search) │  │ (past reviews) │  │ (distilled)│  │
│  └────────┬─────────┘  └──────┬────────┘  └─────┬──────┘  │
└───────────┼───────────────────┼─────────────────┼──────────┘
            │    read via tools │                 │
            ▼                   ▼                 ▼
┌───────────────────────────────────────────────────────────┐
│  Guardrails — input                                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Loop                                               │  │
│  │  build context → call model → run tool → append     │  │
│  │  └─── repeat until final answer or limit hit ───┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│  Guardrails — output                                      │
└───────────────────────────────────────────────────────────┘
            │  structured PRReview output
            ▼
    ┌───────────────────┐
    │  Approval Loop    │  ← reviewer accepts/rejects/edits each finding
    └────────┬──────────┘
             │  accepted findings
             ▼
    reviews/<ticket>_<date>_<slug>.md
             │  (stretch) if GitHub access granted
             ▼
    post to GitHub PR
            │  every step emits an OTel span
            ▼
       Observability
```

---

## Delivery Modes

The harness core (`src/harness/`, `src/agents/`, `src/memory/`) is shared.
Only the delivery layer differs.

### Web app (team deployment)

Hosted on Vercel. Team-shared Supabase memory. React approval UI.

```
Browser → POST /api/review/start  →  returns { reviewId }
                │
     GET /api/review/[id]  (SSE stream of agent progress)
                │
     findings written to Supabase as each agent completes
                │
     /review/[id]  (approval UI — finding cards, checkbox, edit)
                │
     POST /api/review/[id]/finalize  →  GitHub PR + Supabase history
```

**Vercel timeout note:** serverless functions timeout at 60s (hobby) / 300s (pro).
Full reviews run 3–5 minutes. Each agent writes its `DomainResult` to Supabase
as it completes — the browser subscribes via SSE rather than holding one
long-lived connection open.

### CLI (local, no infra)

Runs anywhere Node 20 is installed. SQLite memory, local review files,
terminal approval loop. No account or deployment required.

```bash
npm run review -- https://github.com/org/repo/pull/123
npm run review -- --quick https://github.com/org/repo/pull/123
npm run review -- --post https://github.com/org/repo/pull/123   # posts to GitHub PR
```

Memory defaults to SQLite (`MEMORY_PROVIDER=sqlite`). Switch to Supabase
for team-shared context: `MEMORY_PROVIDER=supabase`.

See [`docs/approval-ui.md`](docs/approval-ui.md) for the full UX spec for
both the web and CLI approval flows.

---

## Multi-Agent Architecture

The PR Review Agent uses a two-phase fan-out rather than a single monolithic loop.
This reduces context dilution, enables parallelism, and makes each reviewer independently
tunable and evaluable.

```
PR URL
  │
  ▼
Context Agent ──── (full loop, tool calls) ──── EnrichedContext
  │                                                    │
  └────────────────────┬───────────────────────────────┘
                       │  Promise.all
         ┌─────────────┼──────────────────────┐
         ▼             ▼      ▼       ▼        ▼
      Style     Conventions  Correctness  Security  Performance
    (single-shot structured output each)
         │             │      │       │        │
         └─────────────┴──────┴───────┴────────┘
                       │
                  Coordinator
               (dedup · calibrate · sort)
                       │
                  PRReview (Zod-validated)
                       │
                 Approval Loop
```

- **Context Agent** runs first with a full agent loop and tool access. Its output
  (`EnrichedContext`) is shared with all domain agents. Designed to fail gracefully —
  domain agents proceed with partial context rather than blocking.
- **Domain agents** are single-shot structured output calls — no tool loop, focused
  system prompts, predictable token usage. Runs in parallel via `Promise.all`.
- **Coordinator** merges findings: deduplicates by file+line proximity, applies
  confidence-based severity calibration, sorts for the approval loop.

For full schema contracts (`Finding`, `EnrichedContext`, `DomainResult`, `PRReview`),
merge rules, domain prompt scopes, execution modes (`--quick`, `--domains`), and the
agent skip-list for small PRs, see [`docs/multi-agent-design.md`](docs/multi-agent-design.md).

---

## The Agent Loop

The loop is the core control structure. It holds no business logic — only
message history and stop conditions.

```typescript
async function run(userInput: string, maxTurns = 10): Promise<string> {
  const messages: Message[] = [{ role: "user", content: userInput }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await model.chat(messages, tools);
    messages.push(reply);
    if (!reply.toolCalls?.length) return reply.text;  // final answer
    for (const call of reply.toolCalls) {
      messages.push(await dispatch(call));
    }
  }
  throw new Error("turn limit reached");
}
```

**Hard stop conditions — all enforced, none optional:**
- `maxTurns` — hard cap on loop iterations (default: 10)
- `maxTokens` — cumulative token budget across all calls in a run
- `timeoutMs` — wall-clock ceiling; a confused agent cannot spin forever

### Model abstraction

The loop only ever calls `ModelClient`. No vendor SDK is imported in the loop.
Swap the adapter via env var — no code changes required.

```typescript
interface ModelClient {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<ModelReply>;
}

const model = createModelClient({
  provider: process.env.LLM_PROVIDER ?? "anthropic", // "anthropic" | "openai" | "ollama"
  model: process.env.LLM_MODEL ?? "claude-3-5-sonnet-20241022",
  apiKey: process.env.LLM_API_KEY,
});
```

### Ticket tracker abstraction

Ticket context (description, acceptance criteria) is fetched via a `TicketClient`
interface. MVP ships with a Linear adapter; Jira and GitHub Issues are planned.

```typescript
interface TicketClient {
  getTicket(id: string): Promise<Ticket>;         // description + AC
  resolveFromPR(pr: PRMetadata): Promise<Ticket | null>; // auto-detect from branch/body
}

const tickets = createTicketClient({
  provider: process.env.TICKET_PROVIDER ?? "linear", // "linear" | "jira" | "github"
  apiKey: process.env.TICKET_API_KEY,
});
```

---

## Approval Loop

After the agent produces its initial review draft, the reviewer steps through
each finding interactively before anything is written to disk.

```
Agent produces draft PRReview
        │
        ▼
For each finding (blocking issues → suggestions → nits):
  Show finding to reviewer
  Reviewer: [A]ccept / [R]eject / [E]dit / [S]kip all remaining nits
        │
        ▼
Reviewer optionally opens markdown file in $EDITOR for final polish
        │
        ▼
Write accepted findings to reviews/<ticket>_<date>_<slug>.md
        │
        ▼ (stretch)
Prompt: "Post this review to the GitHub PR? [y/N]"
```

This loop is the mechanism that keeps the review accurate and prevents
frivolous or hallucinated findings from reaching the PR author.

---

## Review Output Format

The markdown file written to `reviews/` follows this structure, derived from
the project's existing review conventions:

```
reviews/<TICKET-ID>_<YYYY-MM-DD>_<short-slug>.md
```

```markdown
# PR Review — <TICKET-ID> <Title>

**PR:** <GitHub URL>
**Branch:** `<branch>`
**Author:** <author>
**Date:** <date>

---

## 📂 File Coverage
<N> files changed. <M> read in full, <K> legitimately skipped.

| File | Status |
|------|--------|
| path/to/file.ts | ✅ Read |
| path/to/lock.json | ⬜ Skipped (lock file) |

## 🎫 Ticket Context
[Summary from Linear ticket]

## Overview
[One paragraph: what the PR does and how it addresses the ticket]

## ✅ What Looks Good

## 📋 Ticket Alignment
- [x] Requirement — implemented in [file/function]
- [ ] Requirement — **not addressed**

## ⚠️ Suggestions

## 🔴 Blocking Issues

## ❓ Questions

## Testing Recommendations

---

## Verdict
**[Approve / Request Changes / Comment]**
[1-2 sentence summary for the PR author]
```

---

## PR Review Output Schema

The agent's output is validated against this Zod schema before entering the
approval loop. Output that doesn't conform is a guardrail failure.

```typescript
const PRReviewSchema = z.object({
  summary:            z.string(),
  fileCoverage:       z.array(FileCoverageSchema),
  ticketAlignment:    z.array(AlignmentItemSchema),
  whatLooksGood:      z.array(z.string()),
  blockingIssues:     z.array(ReviewFindingSchema),
  suggestions:        z.array(ReviewFindingSchema),
  nits:               z.array(ReviewFindingSchema),
  questions:          z.array(z.string()),
  testingRecommendations: z.array(z.string()),
  verdict:            z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  verdictSummary:     z.string(),
  confidence:         z.number().min(0).max(1),
});
```

---

## Memory & Context Layer

The loop is stateless. The system has memory. Persistent context lives in a
`MemoryStore` and enters the loop only through tools — the loop itself never
holds a database connection.

Review criteria and coding standards are **not hardcoded** in the tool. They
live in user-configured memories, making the harness stack-agnostic and
open-source-safe.

### Three memory types

| Type | What it holds | Access pattern |
|------|--------------|----------------|
| **Memories** | User-defined review criteria, team patterns, coding standards | Injected into system prompt at run start; written via `create_memory()` |
| **Review history** | Full output of every past PR review | `search_past_reviews(query)` — by file, author, or semantic similarity |
| **Code index** | Semantic embeddings of repo files and symbols | `search_codebase(query)` — vector similarity |

### MVP scope

**Memories and Review History ship in v1.** Both are simple Supabase tables.
Review history writes itself automatically after every submission. Memories are
written when a reviewer explicitly creates one (`create_memory()`). Because both
live in Supabase, they are team-shared by default — one reviewer adds a
convention, everyone benefits on future reviews. This is the concrete mechanism
behind "gets smarter with each review."

**Code Index is deferred to v2.** Indexing a repo requires a background job that
runs on every commit, handles chunking and embedding, tracks file changes
incrementally, and incurs ongoing embedding costs per repo. It is the most
powerful memory type (enables `search_codebase` — finding where a pattern is used
elsewhere in the codebase) but carries real infrastructure weight. The MVP Context
Agent skips `search_codebase` calls and works from PR diff + review history alone.

This deferral is intentional, not an oversight. `--quick` mode (which already
skips all codebase search) demonstrates that diff + ticket + review history is
sufficient for meaningful reviews. The code index is an additive improvement, not
a dependency.

### MemoryStore interface

```typescript
interface MemoryStore {
  // v1
  searchReviews(query: string, topK?: number): Promise<ReviewRecord[]>;
  getMemories(context: string): Promise<Memory[]>;
  storeReview(review: PRReview, metadata: PRMetadata): Promise<void>;
  createMemory(content: string, tags: string[]): Promise<void>;
  // v2 — requires code indexer background job
  searchCode(query: string, topK?: number): Promise<CodeChunk[]>;
}

// Adapters:
// LocalMemoryStore    → SQLite  (CLI default, zero infra)
// SupabaseMemoryStore → pgvector (web default, team-shared)
//
// Both adapters implement the full interface. searchCode() returns []
// in LocalMemoryStore until the indexer is run.
```

### Memory injection

Relevant memories are baked into the system prompt before the loop starts:

```typescript
async function buildSystemPrompt(pr: PRMetadata): Promise<string> {
  const memories = await memoryStore.getMemories(pr.repoName);
  return [BASE_SYSTEM_PROMPT, formatMemories(memories)].join("\n\n");
}
```

### Team-shared memory via Supabase

Both the web app and the CLI can point at the same Supabase instance via
`MEMORY_PROVIDER=supabase`. A CLI power user and the web UI are then drawing from
the same pool of memories and review history — team knowledge accumulates
regardless of how individual reviewers run their reviews.

---

## Guardrails

Guardrails are enforced unconditionally — there is no flag or mode that bypasses
them. A guardrail you can skip is not a guardrail.

### Action sandbox

The agent's permitted surface is narrow by design: read everything it needs,
write only to its own output directory, post to GitHub only after explicit human
approval.

| Boundary | Rule |
|----------|------|
| **GitHub API** | `GET` endpoints only. No merge, approve, or request-changes calls. `post_review_comment` is the sole write and is gated behind the approval loop. |
| **Ticket tracker** | `fetch_ticket` and `search_tickets` only. No creating, updating, or transitioning tickets. |
| **File writes** | Sandboxed to `reviews/`. Filenames include a timestamp — existing files are never overwritten. |
| **Memory writes** | `store_review` and `create_memory` are append-only. No delete or update operations exposed. |
| **Code execution** | The agent reads code; it never runs it. No path from repo content to `eval` or shell. |

### Loop health

| Check | Behaviour |
|-------|-----------|
| **Max turns** | Hard stop at configured limit (default 20). Throws `TurnLimitError`. |
| **Max tokens** | Input token budget enforced before each model call. |
| **Timeout** | Wall-clock timeout per run (default 5 min). Kills in-flight tool calls. |
| **Repeated tool call detection** | If the same tool is called with identical args 3 times in a row, the loop aborts. Classic "confused agent" signal. |
| **Tool allow-list** | Anything not registered in `TOOLS` returns an error as data — it never executes. |

### Output integrity

Applied after the loop exits, before the approval loop starts. Malformed output
is rejected and the run fails cleanly — the user never sees raw LLM output.

| Check | Rule |
|-------|------|
| **Schema validation** | Review output must parse against the `PRReview` Zod schema. |
| **File citation check** | Every finding must reference a file that exists in the PR diff. Hallucinated filenames are flagged at validation time. |
| **Secret pattern scan** | Review output is scanned for credential-shaped strings before writing to disk. PRs touching auth code can surface secrets in context — they must not bleed into the written review. |

### Scope creep prevention

A review agent can wander — searching the whole codebase instead of staying
focused on the PR diff.

| Check | Rule |
|-------|------|
| **`external_context_calls` budget** | Agent gets a capped number of codebase searches per review. The cap is configurable; default is 10. Exceeding it returns an error as data. |
| **PR size gate** | If the PR has more than N files or M changed lines, the CLI warns before proceeding. Oversized PRs risk a shallow review or blown token budget — better to surface that upfront than silently produce poor output. |

---

## Checkpoints

Checkpoints are discrete pass/fail gates that run at defined stage boundaries.
Unlike guardrails (which constrain the agent's *actions*), checkpoints evaluate
the agent's *outputs* and decide whether the run may proceed. A failed checkpoint
stops the run with a structured error — the agent never sees a partial result
promoted downstream.

### Checkpoint stages

```
[1] Input Checkpoint      — before the Context Agent starts
[2] Context Checkpoint    — after Context Agent produces EnrichedContext
[3] Domain Checkpoint     — after each domain agent produces DomainResult
[4] Output Checkpoint     — after Coordinator merges all DomainResults
[5] Finalize Checkpoint   — before writing to disk and posting to GitHub
```

| Checkpoint | Pass criteria | Fail behaviour |
|---|---|---|
| **Input** | PR URL resolves; diff is non-empty; PR size within budget | Abort with `PR_TOO_LARGE` or `PR_NOT_FOUND` alarm |
| **Context** | `EnrichedContext` parses against Zod schema; at least diff present | Domain agents receive partial context; alarm emitted |
| **Domain** | `DomainResult` parses against Zod schema; confidence ≥ 0.0 | That domain's findings excluded from merge; alarm emitted |
| **Output** | `PRReview` parses against Zod schema; file citations valid; no secrets | Run fails with `SCHEMA_VALIDATION_FAILED` or `SECRET_DETECTED` alarm |
| **Finalize** | User has explicitly confirmed findings in approval loop | Post to GitHub blocked until confirmed |

### Checkpoint persistence (replay support)

Each checkpoint result is written to the `review_checkpoints` Supabase table as
it passes. A run interrupted after the Domain Checkpoint can resume from that
point — the Coordinator reads persisted `DomainResult` rows rather than
re-running agents. This makes each checkpoint a durable resume point.

```typescript
interface CheckpointRecord {
  reviewId:      string;
  stage:         "INPUT" | "CONTEXT" | "DOMAIN" | "OUTPUT" | "FINALIZE";
  agentName?:    string;          // populated for DOMAIN stage
  status:        "PASS" | "FAIL";
  payload:       unknown;         // the validated output, or error details
  createdAt:     string;
}
```

---

## Alarms

Alarms are structured events emitted whenever a harness limit is breached or an
integrity check fails. They are distinct from observability spans: spans record
what happened; alarms signal that something went wrong and prescribe a response.

Every alarm has a **named type**, **severity**, **context payload**, and a
**recommendedAction** string the caller can surface to the user or log.

### Alarm type

```typescript
type AlarmSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface Alarm {
  alarmType:         AlarmType;
  severity:          AlarmSeverity;
  context:           Record<string, unknown>;
  recommendedAction: string;
  timestamp:         string;
  reviewId?:         string;
}
```

### Alarm catalogue

| AlarmType | Severity | Trigger | Recommended action |
|---|---|---|---|
| `TURN_LIMIT_EXCEEDED` | HIGH | Agent hit `maxTurns` without a final answer | Retry with `--quick` mode; report partial results |
| `TOKEN_BUDGET_EXCEEDED` | HIGH | Cumulative token spend crossed `maxTokens` | Retry with smaller PR or `--quick` mode |
| `TIMEOUT` | HIGH | Wall-clock limit hit mid-run | Retry; check for slow tool (see `tool_errors`) |
| `SCHEMA_VALIDATION_FAILED` | CRITICAL | Agent output doesn't parse against `PRReview` Zod schema | Discard run; surface raw model output for debugging |
| `SECRET_DETECTED` | CRITICAL | Credential-shaped string found in review output | Discard run; do not write to disk; alert engineer |
| `HALLUCINATED_FILE_CITATION` | HIGH | Finding references a file not in the PR diff | Strip finding; flag for quality review |
| `REPEATED_TOOL_CALL` | MEDIUM | Same tool called with identical args 3× in a row | Abort loop; likely confused agent state |
| `SCOPE_BUDGET_EXCEEDED` | MEDIUM | `external_context_calls` cap hit | Continue with gathered context; log for tuning |
| `TOOL_TIMEOUT` | MEDIUM | A single tool call exceeded `TOOL_TIMEOUT_MS` | Return error-as-data; agent decides how to proceed |
| `CHECKPOINT_FAILED` | HIGH | A named checkpoint stage returned FAIL | Stop run at that stage; surface checkpoint error |
| `PR_TOO_LARGE` | LOW | PR exceeds size gate (files or lines) | Warn user; proceed only on explicit confirmation |

### Alarm emission

Alarms are emitted through a single `fireAlarm()` function so every consumer
(OTel, SSE stream, CLI stderr) sees the same structured payload:

```typescript
function fireAlarm(alarm: Alarm): void {
  // 1. Emit as OTel span event (always)
  activeSpan?.addEvent("harness.alarm", alarm);
  // 2. Push to SSE stream for web UI (if a reviewId is active)
  sseEmitter.emit(alarm.reviewId, { type: "alarm", alarm });
  // 3. Write to stderr in CLI mode
  if (process.env.DELIVERY === "cli") {
    console.error(JSON.stringify(alarm));
  }
}
```

---

## Tools

All tool calls flow through `dispatch()` — the single guardrail choke point.

### Tool registry

```typescript
const TOOLS: ToolRegistry = {
  // GitHub tools
  fetch_pr_diff:        { fn: fetchPrDiff,        schema: FetchPrDiffSchema },
  fetch_pr_comments:    { fn: fetchPrComments,    schema: FetchPrCommentsSchema },
  fetch_pr_files:       { fn: fetchPrFiles,       schema: FetchPrFilesSchema },
  post_review_comment:  { fn: postReviewComment,  schema: PostCommentSchema },
  // Ticket tools (Linear adapter in MVP; Jira / GitHub Issues planned)
  fetch_ticket:         { fn: fetchTicket,        schema: FetchTicketSchema },
  search_tickets:       { fn: searchTickets,      schema: SearchTicketsSchema },
  // Memory tools
  search_codebase:      { fn: searchCodebase,     schema: SearchCodebaseSchema },
  search_past_reviews:  { fn: searchPastReviews,  schema: SearchReviewsSchema },
  store_review:         { fn: storeReview,        schema: StoreReviewSchema },
  create_memory:        { fn: createMemory,       schema: CreateMemorySchema },
};
```

### Dispatch — the guardrail choke point

```typescript
async function dispatch(call: ToolCall): Promise<Message> {
  if (!(call.name in TOOLS)) {
    return errMessage(call.id, `unknown tool: ${call.name}`);   // allow-list
  }
  const parsed = TOOLS[call.name].schema.safeParse(call.args);  // arg validation
  if (!parsed.success) return errMessage(call.id, parsed.error.message);
  try {
    const result = await withTimeout(TOOLS[call.name].fn(parsed.data), TOOL_TIMEOUT_MS);
    return toolMessage(call.id, result);
  } catch (e) {
    return toolMessage(call.id, { error: String(e) });          // fail as data
  }
}
```

### Tool guardrail summary

| Tool | Integration | Guardrail |
|------|------------|-----------|
| `fetch_pr_diff` | GitHub | Read-only |
| `fetch_pr_comments` | GitHub | Read-only |
| `fetch_pr_files` | GitHub | Read-only; individual file content truncated to 8 KB |
| `post_review_comment` | GitHub | `DRY_RUN=true` in dev; requires explicit user confirmation |
| `fetch_ticket` | Ticket tracker | Read-only; scoped to configured workspace |
| `search_tickets` | Ticket tracker | Read-only |
| `search_codebase` | Memory | Read-only; result truncated to 4 KB |
| `search_past_reviews` | Memory | Read-only |
| `store_review` | Memory | Write; idempotent on PR id |
| `create_memory` | Memory | Write; append-only |

---

## Observability

Every model call and tool call emits an OTel span. Signals are chosen for what
actually matters in a PR review — not generic agent telemetry.

### Coverage — did the agent actually read the code?

| Signal | What it tracks |
|--------|---------------|
| `files_read` / `files_in_pr` | Did it read everything, or skip large files? |
| `lines_read` / `lines_in_pr` | Truncation detection — how much of each file was consumed? |
| `external_context_calls` | Times it reached outside the diff (codebase search, past reviews, memory lookups) |

These are emitted by the tool executors (`read_file`, `search_codebase`, `search_past_reviews`)
and rolled up into the parent `pr_review` span.

### Cost — what did this review burn?

| Signal | What it tracks |
|--------|---------------|
| `$/review` | Total token cost (input + output) per run |
| `tokens_from_context` vs `tokens_from_diff` | How much budget went to external context vs the PR itself? |

### Quality — collected free from the approval loop

The approval loop is a natural instrumentation point: every finding the reviewer
acts on produces a signal with zero extra labeling overhead.

| Signal | What it tracks |
|--------|---------------|
| `findings_accepted` / `findings_total` | Acceptance rate — best proxy for agent noise |
| `findings_edited` | How many kept findings needed correction? (accuracy gap) |
| `ticket_resolved` | Was the linked ticket found and loaded? (yes/no) |

### Health — is the agent behaving?

| Signal | What it tracks |
|--------|---------------|
| `turns_used` / `turns_max` | Did it hit the loop limit? (complex PR or confused agent) |
| `tool_errors` | Which tools are flaky? |

### Implementation

```typescript
const tracer = trace.getTracer("pr-review-harness");

async function tracedModelCall(messages: Message[], tools: ToolDefinition[]) {
  return tracer.startActiveSpan("llm.call", async (span) => {
    const reply = await client.chat(messages, tools);
    span.setAttributes({
      "llm.model":      reply.model,
      "llm.tokens_in":  reply.usage.inputTokens,
      "llm.tokens_out": reply.usage.outputTokens,
      "llm.cost_usd":   reply.cost,
    });
    span.end();
    return reply;
  });
}

// Approval loop emits quality signals directly
function recordApprovalDecision(finding: Finding, action: "accept" | "edit" | "reject") {
  const span = tracer.startSpan("review.finding");
  span.setAttributes({
    "finding.action":   action,
    "finding.severity": finding.severity,
    "finding.category": finding.category,
  });
  span.end();
}
```

**Dev:** OTLP → stdout (zero dependencies, structured JSON)
**Prod:** point `OTEL_EXPORTER_OTLP_ENDPOINT` at Langfuse, SigNoz, Datadog, or any OTel-compatible backend. No code change required.

---

## Repository Layout

```
gauntlet-harness/
├── app/                         # Next.js App Router (web delivery)
│   ├── api/
│   │   └── review/
│   │       ├── start/route.ts       # POST: kick off review, return reviewId
│   │       ├── [id]/route.ts        # GET: SSE stream of agent progress
│   │       ├── [id]/approve/route.ts  # POST: accept/reject/edit a finding
│   │       └── [id]/finalize/route.ts # POST: write review, post to GitHub
│   └── review/
│       └── [id]/page.tsx            # approval UI — finding cards, checkbox, edit
├── src/
│   ├── harness/                 # shared core — no delivery dependency
│   │   ├── loop.ts              # agent loop + stop conditions
│   │   ├── tools.ts             # Tool type + ToolRegistry helpers
│   │   ├── guardrails.ts        # dispatch(), input/output guards
│   │   ├── observability.ts     # OTel tracer setup, traced wrappers
│   │   └── models.ts            # ModelClient interface + adapters
│   ├── memory/
│   │   ├── store.ts             # MemoryStore interface
│   │   ├── local.ts             # LocalMemoryStore (SQLite) — CLI default
│   │   ├── supabase.ts          # SupabaseMemoryStore (pgvector) — web default
│   │   └── indexer.ts           # repo indexing + chunking logic
│   ├── agents/
│   │   └── pr-review/
│   │       ├── coordinator.ts       # orchestrates phases 1-3, calls merge
│   │       ├── context-agent.ts     # full loop: fetches PR, ticket, memory, codebase
│   │       ├── style-agent.ts       # single-shot: naming, readability, complexity
│   │       ├── conventions-agent.ts # single-shot: team patterns, memories
│   │       ├── correctness-agent.ts # single-shot: logic, edge cases, AC alignment
│   │       ├── security-agent.ts    # single-shot: injection, auth, secrets
│   │       ├── performance-agent.ts # single-shot: queries, loops, memory
│   │       ├── merge.ts             # dedup, confidence calibration, sort
│   │       ├── approval.ts          # approval state machine (shared by CLI + web)
│   │       ├── schema.ts            # all Zod schemas (see docs/multi-agent-design.md)
│   │       └── prompts.ts           # system prompts + domain instruction blocks
│   └── cli/
│       ├── index.ts             # entry point: parse args, call coordinator
│       ├── approval-loop.ts     # terminal finding-by-finding approval
│       └── writer.ts            # writeReviewFile() → reviews/<ticket>_<date>.md
├── docs/
│   ├── approval-ui.md           # web + CLI approval UX spec, FindingDecision schema
│   ├── multi-agent-design.md    # schema contracts, merge rules, execution modes
│   └── brainstorms/
├── reviews/                     # CLI review output (gitignored)
├── evals/
│   └── pr-review/               # ground-truth reviews for eval scoring
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (Node 20, ESM) | Team's primary language — shared across harness, agents, CLI, and web layer |
| Framework | Next.js 14 App Router | Vercel-native, TypeScript-first, streaming API routes, React approval UI |
| Hosting | Vercel (web) / local Node (CLI) | Web for team deployment; CLI for local-first, no-infra use |
| LLM | Pluggable via `ModelClient` | Team uses different models; adapter selected via `LLM_PROVIDER` env var |
| Tool schemas | Zod v3 | Runtime validation + `.toJSONSchema()` produces the schema the model sees |
| Memory (CLI) | SQLite + `@xenova/transformers` | Zero infra — works offline, no account needed |
| Memory (web) | Supabase + pgvector | Cloud-backed, team-shared; same `MemoryStore` interface |
| Observability | `@opentelemetry/sdk-node` | Backend-agnostic; swap exporter without touching instrumentation |
| Git host | GitHub (`@octokit/rest`) | GitLab adapter planned; `GitClient` interface defined |
| Ticket tracker | Linear (`@linear/sdk`) — MVP | Pluggable `TicketClient`; Jira, GitHub Issues adapters planned |
| Tests | `jest` + `ts-jest` | TypeScript-first; consistent with other Andrew projects |

---

## Design Principles

1. **The loop is stateless; the system has memory.** All per-run state lives in
   the message history. Persistent context (code index, review history, memories)
   lives in `MemoryStore` and enters the loop only through tools.

2. **Errors are data.** No exception escapes `dispatch()`. Tool failures return
   `{ error: "..." }` so the model can reason about and recover from them.

3. **Every limit is a hard limit.** Turn caps, token budgets, and timeouts are
   enforced unconditionally. A guardrail you can skip is not a guardrail.

4. **Observability is not optional.** Every code path emits a span. If a step
   can't be observed, it doesn't belong in the harness.

5. **Swap the tools, swap the agent.** The harness is domain-agnostic. Replacing
   `TOOLS` and the system prompt produces a completely different agent.

6. **No stack assumptions.** Review criteria, coding standards, and team patterns
   live in user-configured memories — not in the codebase. The tool works for any
   stack out of the box.

---

## Key Decisions & Rationale

| Decision | Choice | Why | Rejected alternative |
|----------|--------|-----|----------------------|
| Language | TypeScript | Team's primary language; strong typing makes tool schemas safe | Python — reference slides use it, but our team doesn't live there |
| LLM | Pluggable (`ModelClient`) | Team members use different models | Hardcoding a vendor — removes flexibility |
| Schema validation | Zod v3 | `.safeParse()` + `.toJSONSchema()` feeds the model's tool spec automatically | `io-ts` / raw types — less ergonomic |
| Memory backend | Pluggable (`MemoryStore`) | SQLite for dev, Supabase+pgvector for production, no code change | Hardcoded SQLite — can't share memory across team |
| Observability | OpenTelemetry | Emit once, ingest anywhere | Custom logging — no replay, no semantic conventions |
| Tool dispatch | Single `dispatch()` | One choke point — no tool bypasses allow-list + validation + logging | Per-tool middleware — easier to miss a case |
| Review output | `reviews/` markdown file | Reviewer inspects and edits before anything is posted | Direct-to-GitHub — no chance to catch hallucinations |
| Review criteria | User-defined memories | Stack-agnostic, open-source safe | Hardcoded patterns — breaks for non-Supabase teams |

---

## Known Tradeoffs & Open Questions

### Tradeoffs accepted

- **Synchronous tool execution.** Tools run sequentially. Parallel fan-out
  (e.g., fetch diff + fetch comments simultaneously) would be faster but
  complicates message history ordering. Sequential is correct and simple for now.

- **Result truncation is lossy.** Individual file contents are capped at 8 KB.
  Large files get a partial read — noted in the file coverage table.

- **OTel stdout in demo mode.** Readable during the hackathon; not suitable for
  a real team dashboard.

### Open questions

- **PRs larger than context window.** Current plan: truncate and note it. Future:
  chunk the diff, run multiple passes, synthesize.

- **Right `maxTurns` default.** 10 is a calibrated guess. Needs tuning against
  the eval set.

- **Approval loop + direct file editing.** The current design is sequential
  (approval loop first, then open in `$EDITOR`). Should the editor open
  automatically after the loop, or only on request?

- **Eval set quality.** `evals/pr-review/` is planned but empty. The `eval`
  observability signal is a placeholder until ground-truth reviews exist.

### Future goals

- `list_open_prs(repo)` tool — let the reviewer browse and select a PR
  interactively before triggering the review loop.
- Post-approval GitHub submission with `gh` or GitHub MCP.
