# Multi-Agent Design

This document covers the execution model and schema contracts for the
PR Review Agent's multi-agent fan-out architecture.

See `ARCHITECTURE.md` for the high-level design rationale.

---

## Execution Model

Review work is split into two phases:

**Phase 1 — Context Agent** (full agent loop, tool calls enabled)

Fetches and enriches shared context before domain agents run. Other agents
benefit from its output, so it runs first. Designed to fail gracefully —
domain agents proceed with partial context rather than blocking.

**Phase 2 — Domain Agents** (single-shot structured output, parallel)

All five domain agents receive the same `EnrichedContext` and produce
`DomainResult` in a single LLM call each. No tool calls — focused prompts,
predictable token usage, fast.

```typescript
async function reviewPR(prUrl: string): Promise<PRReview> {
  // Phase 1: build and enrich shared context
  const context = await contextAgent.run(prUrl);

  // Phase 2: domain agents in parallel
  const [style, conventions, correctness, security, performance] = await Promise.all([
    styleAgent.run(context),
    conventionsAgent.run(context),
    correctnessAgent.run(context),
    securityAgent.run(context),
    performanceAgent.run(context),
  ]);

  // Phase 3: merge, dedup, rank → hand to approval loop
  return coordinator.merge([style, conventions, correctness, security, performance]);
}
```

---

## Schema Contracts

### `Finding` — the atomic unit

```typescript
const FindingSchema = z.object({
  id:         z.string().uuid(),
  domain:     z.enum(["STYLE", "CONVENTIONS", "CORRECTNESS", "SECURITY", "PERFORMANCE"]),
  severity:   z.enum(["BLOCKING", "SUGGESTION", "NIT"]),
  file:       z.string(),           // must exist in PR diff — enforced by output guardrail
  line:       z.number().optional(), // omitted for file-level findings
  title:      z.string().max(120),  // one-liner shown in the approval loop UI
  body:       z.string(),           // full explanation with evidence from the code
  suggestion: z.string().optional(), // proposed fix, may include a code snippet
  confidence: z.number().min(0).max(1), // agent's stated confidence in this finding
});
```

### `EnrichedContext` — Context Agent output, Domain Agent input

```typescript
const EnrichedContextSchema = z.object({
  prDiff:        PRDiffSchema,
  prFiles:       z.array(FileContentSchema),
  ticket:        TicketSchema.nullable(),
  priorReviews:  z.array(ReviewRecordSchema), // from memory: past reviews of these files
  relatedChunks: z.array(CodeChunkSchema),    // from codebase search: related non-diff code
  memories:      z.array(MemorySchema),       // team standards injected into domain prompts
  externalCalls: z.number(),                  // tracks against the guardrail budget
});
```

### `DomainResult` — each domain agent's output

```typescript
const DomainResultSchema = z.object({
  domain:       FindingSchema.shape.domain,
  findings:     z.array(FindingSchema),
  filesReviewed: z.array(z.string()),  // for coverage tracking
  linesRead:    z.number(),            // for observability
  truncated:    z.boolean(),           // true if hit file or token limit mid-review
  tokensUsed:   z.object({ input: z.number(), output: z.number() }),
});
```

### `PRReview` — coordinator output, approval loop input

```typescript
const PRReviewSchema = z.object({
  prUrl:        z.string().url(),
  ticket:       TicketSchema.nullable(),
  verdict:      z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  summary:      z.string(),              // 2-3 sentence overview written by coordinator
  findings:     z.array(FindingSchema),  // merged, deduped, sorted by severity
  coverage:     CoverageReportSchema,
  agentResults: z.array(DomainResultSchema), // preserved for observability traces
});
```

---

## Coordinator Merge Rules

### Deduplication

Two findings from different domain agents are considered duplicates when they target
the same `file` and their `line` values are within 5 of each other. On merge:
- Keep the finding with the higher `confidence`
- Append the other's `body` as `> Also noted by [DOMAIN]: ...`

This is a deterministic heuristic — no extra LLM call required.

### Confidence → severity downgrade

Each domain agent may overstate severity. The coordinator applies a calibration
pass before handing findings to the approval loop:

| Agent assertion | Confidence threshold | Downgrade |
|----------------|---------------------|-----------|
| `BLOCKING` | < 0.6 | → `SUGGESTION` |
| `SUGGESTION` | < 0.3 | → `NIT` |

### Sort order

Findings are presented to the approval loop in this order:
1. `BLOCKING` (highest confidence first)
2. `SUGGESTION` (highest confidence first)
3. `NIT` (grouped by file)

---

## Domain Agent Prompts

Each agent receives a shared context block (diff, files, ticket, memories) plus a
domain-specific instruction block. The instruction block defines scope strictly —
agents are told explicitly what is *out of scope* to prevent overlap.

| Agent | In scope | Explicitly out of scope |
|-------|----------|------------------------|
| **Style** | Naming, readability, complexity, dead code, comment quality | Logic correctness, security |
| **Conventions** | Team patterns from memories, architectural idioms, ORM/infra standards | Style bikeshedding, business logic |
| **Correctness** | Logic errors, edge cases, AC alignment with ticket | Performance, naming |
| **Security** | Injection, auth, secrets, permissions, data exposure | Style, performance |
| **Performance** | N+1 queries, unbounded loops, memory allocation, algorithmic complexity | Style, correctness |

Tight scope per agent reduces cross-domain noise and makes findings easier to
route during the approval loop.

---

## Execution Modes

### Full mode (default)

All phases run. Context Agent enriches shared context before domain agents fire.
Five domain agents run in parallel. Best for thorough reviews where quality matters
more than speed.

```bash
npm run review -- https://github.com/org/repo/pull/123
```

### Quick mode (`--quick`)

Skips the Context Agent entirely — no codebase search, no prior review lookup,
no memory injection. Runs only the Correctness and Security domain agents.
Surfaces BLOCKING findings only.

Goal: blocking issues and security catches in ~30 seconds, not 5 minutes.

```bash
npm run review -- --quick https://github.com/org/repo/pull/123
```

```
(diff + ticket only)
       │
       ├──► Correctness agent  ─┐
       └──► Security agent     ─┴──► Coordinator ──► Approval Loop
```

Output is labeled with a `mode: "quick"` field and a banner in the review file:

```markdown
> ⚡ Quick review — Style, Conventions, and Performance checks skipped.
```

### Domain-scoped mode (`--domains`)

Full Context Agent runs, but only the specified domain agents fire. Useful when
the PR is clearly in a specific domain (e.g. a security-sensitive change) and
you don't want noise from other agents.

```bash
npm run review -- --domains=correctness,security https://github.com/org/repo/pull/123
```

### Mode comparison

| | Full | Quick | Domain-scoped |
|-|------|-------|--------------|
| Context Agent | ✅ | ❌ | ✅ |
| Domain agents | All 5 | Correctness + Security | Selected |
| Memory injection | ✅ | ❌ | ✅ |
| Codebase search | ✅ | ❌ | ✅ |
| Finding severities | All | BLOCKING only | All |
| Typical runtime | ~3–5 min | ~30 sec | ~1–3 min |
| Output label | `full` | `quick` | `scoped` |

---

## Skipping Agents for Small PRs

The coordinator inspects the PR before fanning out and can skip agents that
are unlikely to produce signal:

| Condition | Skip |
|-----------|------|
| PR is docs-only (`.md`, `.txt` changes) | Performance, Security |
| PR touches only test files | Style (mostly), Performance |
| PR has ≤ 2 files changed | Context Agent codebase search (use diff only) |

Skipped agents produce an empty `DomainResult` with `findings: []` and
`truncated: false`. They are still included in `agentResults` for observability.

---

## Repository Layout (agents)

```
src/agents/pr-review/
├── coordinator.ts      # orchestrates phases, calls merge
├── context-agent.ts    # full loop agent: fetches PR, ticket, memory, codebase
├── style-agent.ts      # single-shot: naming, readability, complexity
├── conventions-agent.ts # single-shot: team patterns, memories
├── correctness-agent.ts # single-shot: logic, edge cases, AC alignment
├── security-agent.ts   # single-shot: injection, auth, secrets
├── performance-agent.ts # single-shot: queries, loops, memory
├── merge.ts            # dedup, confidence calibration, sort
├── approval.ts         # runApprovalLoop() — CLI item-by-item review
├── writer.ts           # writeReviewFile() — markdown output to reviews/
├── schema.ts           # all Zod schemas: Finding, EnrichedContext, DomainResult, PRReview
└── prompts.ts          # system prompts + domain instruction blocks
```
