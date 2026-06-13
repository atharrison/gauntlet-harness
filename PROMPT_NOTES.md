# Hackathon Prompt Notes

Reference material from the Fired Festival brief. Source of truth for the
four-pillar framing we are implementing.

---

## The Idea

> The model is the engine. The harness is the car.

An LLM only maps tokens to tokens. Everything that makes it *useful and safe* —
memory, actions, retries, limits, logging — lives in the code wrapped around it.
That wrapper is the harness.

| Raw model call | Model + harness |
|---|---|
| One prompt in, one completion out | Multi-turn loop with state |
| No memory of prior turns | Calls tools and reads results |
| Can't take actions | Validated, bounded, retried |
| No limits, no audit trail | Every step traced |

---

## The Four Pillars

Whatever framework you use, these four responsibilities are always present.

### Pillar 1 — Chat / Loop

Drives reasoning across turns until the task is done.

The core control structure: keep calling the model, feeding back tool results,
until it emits a final answer or hits a limit.

```
1. Build context   →   system prompt + history + new input
2. Call model      →   get text or a tool request
3. Run tool        →   execute, capture result
4. Append          →   add result to history
5. Repeat / stop   →   loop until done or capped
```

> The stop condition matters as much as the steps: cap turns, tokens, and
> wall-clock time so a confused agent can't spin forever.

### Pillar 2 — Tools

Lets the model read data and change the outside world.

A tool is a typed function the model can request. The harness validates the
arguments, executes it, and returns the result as the next message.

| Part | Description |
|------|-------------|
| **Schema** | Name, description, and a typed parameter spec the model reads to decide how to call it |
| **Executor** | Your real code — DB query, API call, file write — that runs when the model invokes the tool |
| **Result contract** | Return predictable, parseable output. Errors come back as data the model can react to, not crashes |

Engineering concerns: idempotency, per-tool timeouts, retries with backoff, and
truncating large results before they blow the context window.

### Pillar 3 — Guardrails

Constrains inputs, outputs, and actions to safe bounds.

Layered checks on the way in, the way out, and around the loop. The model will
eventually do the wrong thing — design so it can't do damage.

```
Input   →  Strip injection, validate and size-limit what enters the prompt
Action  →  Allow-list tools, scope permissions, require approval for risky calls
Output  →  Schema-check, filter, and fact-gate responses before they ship
```

Plus the hard limits: turn caps, token budgets, timeouts, and spend ceilings.

### Pillar 4 — Observability

Records what happened so you can debug and improve.

Agents fail in non-obvious ways across many steps. Emit a structured span per
model and tool call so you can replay, alert, and score.

The four signals that actually move reliability:

| Signal | What it measures |
|--------|-----------------|
| **p95** | Latency per model call and per tool span |
| **$/run** | Token cost — input + output, per trace |
| **err%** | Tool error rate — failures and retries |
| **eval** | Pass rate scored vs. a test set |

---

## How the Pillars Stack

A request flows down through the layers and back. Guardrails wrap the loop;
observability watches all of it.

```
Guardrails — input     Validate the incoming request before it ever reaches the model
Loop + Tools           The model reasons, calls allow-listed tools, reads results, iterates
Guardrails — output    Validate the final response against schema and safety rules
Observability          Every step above emits a trace event for debugging, cost tracking, and evals
```

---

## Example Domains

Same four pillars, different tools and guardrails. Swap the toolset → new agent.

| Agent | Tools | Guardrail |
|-------|-------|-----------|
| Coding agent | read/write files, run tests, grep | sandbox + diff review |
| Research assistant | web search, fetch, cite | source allow-list + claim checks |
| Support triage | ticket lookup, KB search, tag | human approval to reply |
| Data copilot | SQL query, chart | read-only DB role + row limits |
| Inbox agent | search mail, draft | draft-only, never auto-send |
| Ops runbook | check status, restart | dry-run + on-call confirm |
