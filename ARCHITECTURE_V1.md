# Gauntlet Harness — Architecture

A PR review agent built on a four-pillar harness: Loop, Tools, Guardrails,
Observability. The harness is generic — swap the tool set and system prompt
to produce a different agent.

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
            │  write via tools after review completes
            ▼
     store_review() + create_memory()
            │  every step emits an OTel span
            ▼
       Observability
```

---

## Entry Point

The reviewer manually provides a GitHub PR URL as the first input to the harness.

```typescript
// npm run review -- https://github.com/org/repo/pull/123
const prUrl = process.argv[2]
const review = await reviewPR(prUrl)
```

```typescript
async function reviewPR(prUrl: string): Promise<PRReview> {
  const pr = await parsePrUrl(prUrl)
  const systemPrompt = await buildSystemPrompt(pr) // memories injected here

  return runAgent({
    systemPrompt,
    userInput: formatReviewRequest(pr),
    tools: TOOLS,
    outputSchema: PRReviewSchema,
  })
}
```

The Linear ticket is resolved during the review loop via `fetch_linear_ticket`
— the agent extracts the issue ID from the branch name or PR body and calls the
tool itself.

**Future:** `list_open_prs(repo)` tool that returns open PRs for selection
before kicking off a review. Nice UX improvement but not needed for v1.

---

The loop is the core control structure. It holds no business logic — only
message history and stop conditions.

```typescript
async function run(userInput: string, maxTurns = 10): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: userInput }]
  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await model.chat(messages, tools)
    messages.push(reply)
    if (!reply.toolCalls?.length) return reply.text // final answer
    for (const call of reply.toolCalls) {
      messages.push(await dispatch(call))
    }
  }
  throw new Error('turn limit reached')
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
  chat(messages: Message[], tools: ToolDefinition[]): Promise<ModelReply>
}

const model = createModelClient({
  provider: process.env.LLM_PROVIDER ?? 'anthropic', // "anthropic" | "openai" | "ollama"
  model: process.env.LLM_MODEL ?? 'claude-3-5-sonnet-20241022',
  apiKey: process.env.LLM_API_KEY,
})
```

---

## Memory & Context Layer

The loop is stateless. The system has memory. Persistent context lives in a
`MemoryStore` and enters the loop only through tools — the loop itself never
holds a database connection.

### Three memory types

| Type               | What it holds                                 | Access pattern                                                          |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| **Code index**     | Semantic embeddings of repo files and symbols | `search_codebase(query)` — vector similarity                            |
| **Review history** | Full output of every past PR review           | `search_past_reviews(query)` — by file, author, or semantic similarity  |
| **Memories**       | Distilled, durable insights from past reviews | Injected into system prompt at run start; written via `create_memory()` |

### MemoryStore interface

```typescript
interface MemoryStore {
  searchCode(query: string, topK?: number): Promise<CodeChunk[]>
  searchReviews(query: string, topK?: number): Promise<ReviewRecord[]>
  getMemories(context: string): Promise<Memory[]>
  storeReview(review: PRReview, metadata: PRMetadata): Promise<void>
  createMemory(content: string, tags: string[]): Promise<void>
}

// Adapters:
// LocalMemoryStore    → SQLite + local embeddings  (default, zero infra)
// SupabaseMemoryStore → pgvector                   (production, team-shared)
```

### Memory injection

Relevant memories are baked into the system prompt before the loop starts, so
the agent begins with project context at zero tool-call cost:

```typescript
async function buildSystemPrompt(pr: PRMetadata): Promise<string> {
  const memories = await memoryStore.getMemories(pr.repoName)
  return [BASE_SYSTEM_PROMPT, formatMemories(memories)].join('\n\n')
}
```

---

## Tools

Tools are registered with a Zod schema (used for both validation and JSON schema
generation) and an executor function. Every tool call flows through `dispatch()`.

### Tool registry

```typescript
const TOOLS: ToolRegistry = {
  // GitHub tools
  fetch_pr_diff: { fn: fetchPrDiff, schema: FetchPrDiffSchema },
  fetch_pr_comments: { fn: fetchPrComments, schema: FetchPrCommentsSchema },
  post_review_comment: { fn: postReviewComment, schema: PostCommentSchema },
  create_ticket: { fn: createTicket, schema: CreateTicketSchema },
  // Linear tools
  fetch_linear_ticket: {
    fn: fetchLinearTicket,
    schema: FetchLinearTicketSchema,
  },
  search_linear_issues: {
    fn: searchLinearIssues,
    schema: SearchLinearIssuesSchema,
  },
  // Memory tools
  search_codebase: { fn: searchCodebase, schema: SearchCodebaseSchema },
  search_past_reviews: { fn: searchPastReviews, schema: SearchReviewsSchema },
  store_review: { fn: storeReview, schema: StoreReviewSchema },
  create_memory: { fn: createMemory, schema: CreateMemorySchema },
}
```

### Dispatch — the guardrail choke point

Every tool call passes through one function. No tool bypasses it.

```typescript
async function dispatch(call: ToolCall): Promise<Message> {
  if (!(call.name in TOOLS)) {
    return errMessage(call.id, `unknown tool: ${call.name}`) // allow-list
  }
  const parsed = TOOLS[call.name].schema.safeParse(call.args) // arg validation
  if (!parsed.success) return errMessage(call.id, parsed.error.message)
  try {
    const result = await withTimeout(
      TOOLS[call.name].fn(parsed.data),
      TOOL_TIMEOUT_MS
    )
    return toolMessage(call.id, result)
  } catch (e) {
    return toolMessage(call.id, { error: String(e) }) // fail as data
  }
}
```

### Tool guardrail summary

| Tool                   | Integration | Guardrail                                                |
| ---------------------- | ----------- | -------------------------------------------------------- |
| `fetch_pr_diff`        | GitHub      | Read-only                                                |
| `fetch_pr_comments`    | GitHub      | Read-only                                                |
| `post_review_comment`  | GitHub      | `DRY_RUN=true` blocks posting in dev                     |
| `create_ticket`        | GitHub      | Requires explicit `confirm: true` in args                |
| `fetch_linear_ticket`  | Linear      | Read-only; scoped to tickets in the configured workspace |
| `search_linear_issues` | Linear      | Read-only; returns title + AC only, not full content     |
| `search_codebase`      | Memory      | Read-only; result truncated to 4 KB                      |
| `search_past_reviews`  | Memory      | Read-only                                                |
| `store_review`         | Memory      | Write; idempotent on PR id                               |
| `create_memory`        | Memory      | Write; append-only                                       |

---

## Observability

Every model call and every tool call emits an OTel span. Backend is swappable
via exporter config — no instrumentation changes needed.

```typescript
const tracer = trace.getTracer('harness')

async function tracedModelCall(messages: Message[], tools: ToolDefinition[]) {
  return tracer.startActiveSpan('llm.call', async span => {
    const reply = await client.chat(messages, tools)
    span.setAttributes({
      'llm.model': reply.model,
      'llm.tokens_in': reply.usage.inputTokens,
      'llm.tokens_out': reply.usage.outputTokens,
      'llm.cost_usd': reply.cost,
    })
    span.end()
    return reply
  })
}
```

**Backends:**

- Dev/demo: OTLP → stdout (zero dependencies, structured JSON)
- Production: OTLP → Langfuse Cloud or SigNoz (swap exporter, no code change)

---

## PR Review Agent Output Schema

The agent's final answer is validated against this schema before being returned.
Output that doesn't conform is rejected as a guardrail failure.

```typescript
const PRReviewSchema = z.object({
  summary: z.string(),
  blockingIssues: z.array(ReviewCommentSchema),
  suggestions: z.array(ReviewCommentSchema),
  nits: z.array(ReviewCommentSchema),
  followOnTickets: z.array(TicketDraftSchema),
  confidence: z.number().min(0).max(1),
})

type PRReview = z.infer<typeof PRReviewSchema>
```

---

## Repository Layout

```
gauntlet-harness/
├── src/
│   ├── harness/
│   │   ├── loop.ts          # agent loop + stop conditions
│   │   ├── tools.ts         # Tool type + ToolRegistry helpers
│   │   ├── guardrails.ts    # dispatch(), input/output guards
│   │   ├── observability.ts # OTel tracer setup, traced wrappers
│   │   └── models.ts        # ModelClient interface + Anthropic/OpenAI adapters
│   ├── memory/
│   │   ├── store.ts         # MemoryStore interface
│   │   ├── local.ts         # LocalMemoryStore (SQLite + embeddings)
│   │   ├── supabase.ts      # SupabaseMemoryStore (pgvector)
│   │   └── indexer.ts       # repo indexing + chunking logic
│   └── agents/
│       └── pr-review/
│           ├── agent.ts     # wires harness + memory to PR review domain
│           ├── tools.ts     # GitHub + memory tool executors
│           ├── schema.ts    # PRReview Zod schema
│           └── prompts.ts   # system prompt (with memory injection)
├── evals/
│   └── pr-review/           # ground-truth reviews for eval scoring
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

---

## Tech Stack

| Layer          | Choice                          | Rationale                                                                 |
| -------------- | ------------------------------- | ------------------------------------------------------------------------- |
| Language       | TypeScript (Node 20, ESM)       | Team's primary language — easy to extend and maintain post-hackathon      |
| LLM            | Pluggable via `ModelClient`     | Team uses different models; adapter selected via `LLM_PROVIDER` env var   |
| Tool schemas   | Zod v3                          | Runtime validation + `.toJSONSchema()` produces the schema the model sees |
| Memory (local) | SQLite + `@xenova/transformers` | Zero infra — works offline, no server needed for dev/demo                 |
| Memory (prod)  | Supabase + pgvector             | Team-shared, cloud-backed; same `MemoryStore` interface                   |
| Observability  | `@opentelemetry/sdk-node`       | Backend-agnostic; swap exporter without touching instrumentation          |
| GitHub API     | `@octokit/rest`                 | Official, fully typed; PAT auth only                                      |
| Linear API     | `@linear/sdk`                   | Official TypeScript SDK; fetch tickets + AC by issue ID or URL            |
| Tests          | `vitest`                        | Fast, native ESM, TypeScript-first                                        |

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

---

## Key Decisions & Rationale

| Decision          | Choice                    | Why                                                                                                      | Rejected alternative                                                           |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Language          | TypeScript                | Team's primary language; strong typing makes tool schemas and the `ModelClient` interface safe to extend | Python — reference slides use it, but our team doesn't live there              |
| LLM               | Pluggable (`ModelClient`) | Team members use different models; no coupling to a single vendor                                        | Hardcoding Claude or GPT-4o — removes team flexibility                         |
| Schema validation | Zod v3                    | `.safeParse()` for runtime safety; `.toJSONSchema()` feeds the model's tool spec automatically           | `io-ts` / raw types — less ergonomic; Zod is the TypeScript community standard |
| Memory backend    | Pluggable (`MemoryStore`) | Local SQLite for dev/demo; Supabase+pgvector for production without code changes                         | Hardcoded SQLite — can't share memory across the team                          |
| Observability     | OpenTelemetry             | Emit once, ingest anywhere — stdout today, Langfuse/SigNoz tomorrow                                      | Custom logging — no replay, no dashboards, no semantic conventions             |
| Tool dispatch     | Single `dispatch()`       | One choke point for allow-list, validation, timeout, logging — no tool can bypass it                     | Per-tool middleware — harder to reason about; easier to miss a case            |
| GitHub API        | `@octokit/rest`           | Official, fully typed; PAT auth is sufficient for the use case                                           | GraphQL API — more powerful but unnecessary complexity                         |
| Linear API        | `@linear/sdk`             | Official TypeScript SDK; gives us ticket description + AC as structured data                             | REST + manual parsing — less reliable, not typed                               |

---

## Known Tradeoffs & Open Questions

### Tradeoffs accepted

- **Synchronous tool execution.** Tools run sequentially. A review pass could fan
  out (`fetch_pr_diff` + `fetch_pr_comments` in parallel), but parallel execution
  complicates message history ordering. Sequential is correct and simple for now.

- **Result truncation is lossy.** Diffs larger than context budget are trimmed.
  The model reviews a partial diff — acknowledged in the output summary. Better
  than a context-window crash; worse than full coverage.

- **OTel stdout in demo mode.** The terminal is the observability backend during
  the hackathon. Readable, but not suitable for a real team.

### Open questions

- **PRs larger than the context window.** Current plan: truncate, note it in
  output. Planned but not designed: chunk the diff, run multiple passes,
  synthesize results.

- **Right `maxTurns` default.** 10 is a guess calibrated to "enough turns for a
  thorough review without burning tokens on a confused agent." Needs empirical
  tuning against the eval set.

- **Approval gate UX for `post_review_comment`.** `DRY_RUN` flag works for dev
  but a real deployment would want an interactive confirmation step. Not designed.

- **Eval set quality.** `evals/pr-review/` is planned but empty. Without
  ground-truth reviews, the `eval` observability signal is a placeholder.
