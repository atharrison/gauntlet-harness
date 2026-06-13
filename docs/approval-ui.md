# Approval UI

The approval step is where the reviewer curates the agent's findings before
anything reaches the PR author. It is implemented twice — once for the web app,
once for the CLI — using the same underlying `FindingDecision` schema.

---

## Shared Contract

```typescript
// The decision the reviewer makes about each finding
interface FindingDecision {
  findingId: string;
  included: boolean;
  editedBody?: string;       // present only if reviewer changed it
  editedSuggestion?: string; // present only if reviewer changed it
}

// What gets submitted
interface ReviewSubmission {
  reviewId: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  summaryNote?: string;      // optional top-level comment from the reviewer
  decisions: FindingDecision[];
}
```

`FindingDecision` feeds the observability quality signals directly:
`included` → acceptance rate, `editedBody` present → edit rate.

---

## Web UI

### Layout

Findings are displayed as cards, grouped by severity:

```
🔴 Blocking  (N)      ← always shown first, all checked by default
🟡 Suggestions (N)    ← shown second, all checked by default
⚪ Nits  (N)          ← shown last, unchecked by default
```

Nits start unchecked — the default submission excludes them unless the
reviewer actively opts in. This shifts the burden from "reject noise"
to "opt in to what you want."

### Per-card

Each finding card shows:
- Severity badge · domain badge (Style / Correctness / Security / etc.)
- `file:line` reference
- Title (one-liner)
- Body (full explanation with evidence)
- Suggested fix (code block, if present)
- Confidence indicator (subtle visual — low confidence findings appear softer)
- Checkbox to include/exclude
- Edit button → body and suggestion become inline editable textareas; changes
  persist locally until submission

### Toolbar

- **Filter by domain:** `All · Style · Conventions · Correctness · Security · Performance`
- **Bulk select:** "Select all blocking" · "Deselect all nits"

### Summary bar (sticky bottom)

```
3 blocking · 5 suggestions · 2 nits selected
Verdict: Request Changes  [▾]     [Optional note...]     [Submit Review]
```

- Verdict is auto-suggested:
  - Any `BLOCKING` finding included → `REQUEST_CHANGES`
  - Suggestions only → `COMMENT`
  - Nothing included → `APPROVE`
- Reviewer can override the verdict at any time

### Submit flow

1. Reviewer checks/unchecks findings, edits where needed
2. Confirms verdict and optional top-level note
3. Clicks **Submit Review**
4. `POST /api/review/[id]/finalize` with `ReviewSubmission`
5. API constructs GitHub review body from selected + edited findings
6. Posts to GitHub PR via `post_review_comment`
7. Final review (with decisions) written to Supabase for memory/history

---

## CLI

The CLI approval loop presents findings one at a time in severity order.
Nits are presented as a batch at the end with an option to skip all.

```
──────────────────────────────────────────────
🔴 Blocking [1/2] — PaymentService.ts:88
──────────────────────────────────────────────
Retry loop has no backoff — will hammer the API on failure.

Suggestion:
  await sleep(Math.pow(2, attempt) * 100);

[A]ccept  [R]eject  [E]dit  [?] help
> _
```

**Edit flow:** pressing `E` opens the finding body in `$EDITOR`. On save,
the edited version is used.

**Nit batch at the end:**

```
──────────────────────────────────────────────
⚪ Nits — 4 found
──────────────────────────────────────────────
  1. auth/middleware.ts:12 — unused import
  2. utils/format.ts:34 — prefer const
  3. ...

[I]nclude all  [S]kip all  [R]eview one by one
> _
```

**Final step:**

```
──────────────────────────────────────────────
Review summary: 2 blocking · 3 suggestions · 0 nits
Verdict: REQUEST_CHANGES

Optional note (Enter to skip): > _

[C]onfirm and write  [A]bort
```

Output is written to `reviews/<ticket>_<date>_<slug>.md` locally.
`post_review_comment` is available as an explicit flag: `--post`.

```bash
npm run review -- --post https://github.com/org/repo/pull/123
```

---

## Memory: what gets stored after submission

Both delivery modes write the same record to the memory store after a review
is finalized:

```typescript
interface ReviewRecord {
  prUrl: string;
  prNumber: number;
  ticket: string | null;
  files: string[];
  verdict: string;
  findingsTotal: number;
  findingsAccepted: number;
  findingsEdited: number;
  review: PRReview;          // full agent output (including rejected findings)
  submission: ReviewSubmission; // what the reviewer actually sent
  createdAt: string;
}
```

Storing both the full agent output and the reviewer's decisions means future
reviews can learn what *this reviewer* tends to accept — not just what the
agent tends to generate.
