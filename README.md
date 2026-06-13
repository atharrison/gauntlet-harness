# PR Review Harness

**AI-powered pull request review with human-in-the-loop approval.**  
Paste a GitHub PR URL, watch multiple specialized agents review it in parallel, then curate the findings before anything reaches your team. Gets smarter with every review — past reviews and team standards are injected as context automatically.

Live: **https://gauntlet-review-harness.up.railway.app**

---

## How It Works

Paste a PR URL. The harness runs a multi-agent pipeline, streams live progress to the browser, and presents findings as cards you can accept, reject, or edit inline. Once you submit, a structured comment posts to the GitHub PR.

```
Browser → POST /api/review/start
        → GET  /api/review/[id]          (SSE stream — live agent progress)
        → /review/[id]                   (approval UI — finding cards, inline edit)
        → POST /api/review/[id]/finalize → Supabase history + GitHub PR comment
```

**Full mode** (~2 min): Context Agent gathers PR diff, ticket, and past review context, then Correctness and Security agents run in parallel.

**⚡ Quick mode** (~30s): skips the Context Agent, runs Correctness + Security directly on the raw diff, surfaces `BLOCKING` findings fast. Toggle on the home page.

---

## Architecture

```
                    Context Agent
               (full loop · up to 15 turns)
          fetch diff → fetch files → fetch ticket → search memory
                              │  EnrichedContext
                 ┌────────────┴────────────┐
                 ▼                         ▼
        Correctness Agent          Security Agent
        (single-shot)              (single-shot)
        DomainResult               DomainResult
                 └────────────┬────────────┘
                              │
                        mergeResults()
                  dedup · confidence calibration
                  BLOCKING → SUGGESTION → NIT sort
                              │  PRReview (Zod-validated)
                              ▼
                  Coordinator summary call
                              │
                       Approval UI
               accept / reject / edit per finding
                              │
                  finalize → Supabase + GitHub
```

---

## The Four Pillars

### Guardrails (`src/harness/guardrails.ts`, `src/harness/tools.ts`)

- **Allow-list dispatch** — every tool call flows through `dispatch()`. Unknown tools return error-as-data, never execute.
- **Zod argument validation** — malformed args are rejected before the function is called.
- **Tool timeout** — each call is wrapped in `withTimeout()`, fires `TOOL_TIMEOUT` alarm after 30s.
- **Read-only by construction** — GitHub/ticket tools are read-only. `post_review_comment` is the only write, gated behind explicit reviewer approval.
- **Output integrity** — file citation check (hallucinated filenames stripped), secret pattern scan (fires `SECRET_DETECTED` alarm), Zod schema validation on every `PRReview`.

### Checkpoints (`src/harness/checkpoints.ts`)

Five named pipeline stages, each with a defined pass/fail criterion. Results persist to Supabase and fire alarms on failure.

| Stage | Pass criterion |
|---|---|
| `INPUT` | `prUrl` present |
| `CONTEXT` | diff non-empty or files changed |
| `DOMAIN` | both domain agents returned without throwing |
| `OUTPUT` | `PRReviewSchema.safeParse()` succeeds |
| `FINALIZE` | decisions present and non-empty |

### Material Handling (`src/harness/tools.ts`, `src/harness/context.ts`)

All external dependencies are behind interfaces and injected via `createReviewContext()` — no harness-core code imports from Anthropic, GitHub, or Supabase directly.

| Layer | Default | Swap via |
|---|---|---|
| LLM | Anthropic Claude | `ModelClient` interface |
| Git host | GitHub | `OctokitClient` interface |
| Ticket tracker | Linear | `TicketClient` interface |
| Memory store | Supabase | `MEMORY_PROVIDER=sqlite` |

### Alarms (`src/harness/alarms.ts`)

Named, structured alerts that fire at known risk points. Delivered to `stderr` (structured JSON) and streamed to the browser via SSE.

| Alarm | Severity |
|---|---|
| `TURN_LIMIT_EXCEEDED` | HIGH |
| `TOKEN_BUDGET_EXCEEDED` | HIGH |
| `TIMEOUT_EXCEEDED` | HIGH |
| `TOOL_TIMEOUT` | MEDIUM |
| `REPEATED_TOOL_CALL` | MEDIUM |
| `CHECKPOINT_FAILED` | HIGH |
| `HALLUCINATED_FILE_CITATION` | MEDIUM |
| `SECRET_DETECTED` | CRITICAL |
| `PR_TOO_LARGE` | LOW |

---

## Observability

Every review emits a `stats` SSE event on completion — rendered live in the pipeline sidebar.

- **Token count + estimated cost** across all four pipeline phases
- **Per-phase timing bars** (INPUT / CONTEXT / DOMAIN / OUTPUT)
- **OpenTelemetry spans** — `harness.review` root span with child spans per phase, attributes: `tokens.total`, `cost.usd`, `findings.count`, `review.verdict`
- **Structured stdout log** — `harness_run_complete` JSON line on every run (queryable in Railway)
- Set `OTEL_EXPORTER_OTLP_ENDPOINT` to ship traces to Honeycomb, Jaeger, Datadog, etc.

---

## What's Shipped

- [x] Multi-agent pipeline: Context + Correctness + Security agents
- [x] Full mode and ⚡ Quick mode (UI toggle on home page)
- [x] Live SSE activity feed + pipeline stage tracker
- [x] Approval UI: accept / reject / inline edit per finding
- [x] Submit findings + post comment to GitHub PR
- [x] Approve PR (LGTM) for clean reviews with no findings
- [x] Review cache — replay completed reviews instantly on page reload
- [x] Supabase persistence: review history + checkpoints + memory
- [x] OpenTelemetry trace spans + structured Railway logs
- [x] Railway deployment with health check endpoint

## What's Next

- [ ] **Review history** (`/history` page) — browse past reviews, click to replay
- [ ] **Authentication** — Supabase SSR auth to protect review data
- [ ] **Automated triggers** — GitHub webhook receiver, auto-review on PR open/push
- [ ] **Alarm badges** in pipeline sidebar (currently in activity feed only)
- [ ] **Additional domain agents** — Style, Conventions, Performance (framework in place)
- [ ] **Prometheus `/metrics` endpoint** — scrape-based metrics alongside OTel traces

---

## Try It

Not sure what to paste in? Use this sample PR — it's a Python Advent of Code solution with several real issues the harness is good at catching:

**[https://github.com/atharrison/python-adventofcode2020/pull/1](https://github.com/atharrison/python-adventofcode2020/pull/1)**

What to expect from a full-mode review:
- A `BLOCKING` finding on the CRT sieve in `day13.py` — `step *= n` is subtly wrong for non-coprime inputs; should be `lcm(step, n)`
- A `BLOCKING` finding in `schedule.py` — no bounds check before `data[0]` / `data[1]`, crashes on malformed input
- A `SUGGESTION` for unhandled empty bus list edge case in `solve_part1`

The harness picks these up without any hints — purely from reading the diff, the PR description, and reasoning about the algorithm.

---



```bash
# Deployed
open https://gauntlet-review-harness.up.railway.app

# Local dev
cp .env.example .env   # fill in required keys below
npm install
npm run dev

# Tests
npm test
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `GITHUB_TOKEN` | Yes | GitHub personal access token (repo read scope) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `LINEAR_API_KEY` | No | Linear API key — ticket context degrades gracefully without it |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Ship OTel traces to an external backend |
| `DRY_RUN` | No | Set `true` to suppress all GitHub writes (safe for dev/demo) |
| `DEBUG_LLM` | No | Set `true` to log raw LLM output on parse failures |

---

## Docs

- [`HARNESS.md`](HARNESS.md) — four-pillar design doc (hackathon deliverable)
- [`MASTER_CHECKLIST.md`](MASTER_CHECKLIST.md) — build day checklist + future roadmap
