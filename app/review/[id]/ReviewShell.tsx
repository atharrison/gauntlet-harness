'use client'

import { useEffect, useRef, useState } from 'react'

interface Finding {
  id: string
  severity: 'BLOCKING' | 'SUGGESTION' | 'NIT'
  category: string
  file: string
  line?: number
  title: string
  body: string
  confidence: number
  suggestedFix?: string
}

interface FindingDecision {
  findingId: string
  accepted: boolean
  editedTitle?: string
  editedBody?: string
}

type StreamStatus = 'connecting' | 'running' | 'done' | 'error'
type PhaseStatus = 'pending' | 'running' | 'done' | 'error'

interface ActivityEntry {
  id: number
  type: 'tool' | 'phase' | 'finding' | 'alarm'
  text: string
}

const SEVERITY_STYLES: Record<Finding['severity'], string> = {
  BLOCKING: 'border-red-600 bg-red-950/30',
  SUGGESTION: 'border-yellow-600 bg-yellow-950/30',
  NIT: 'border-gray-700 bg-gray-900/50',
}

const SEVERITY_BADGE: Record<Finding['severity'], string> = {
  BLOCKING: 'bg-red-700 text-red-100',
  SUGGESTION: 'bg-yellow-700 text-yellow-100',
  NIT: 'bg-gray-700 text-gray-300',
}

const PIPELINE: { key: string; label: string }[] = [
  { key: 'INPUT', label: 'Input validation' },
  { key: 'CONTEXT', label: 'Context agent' },
  { key: 'DOMAIN', label: 'Domain agents' },
  { key: 'OUTPUT', label: 'Final review' },
]

function formatTool(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'fetch_pr_diff':
      return 'Reading PR diff…'
    case 'fetch_pr_files':
      return 'Listing changed files…'
    case 'fetch_ticket':
      return `Fetching ticket ${args.ticketId ?? ''}…`
    case 'search_past_reviews':
      return `Searching history: ${args.file ?? ''}…`
    default:
      return tool.replace(/_/g, ' ') + '…'
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

interface Props {
  reviewId: string
  prUrl: string
  mode?: 'full' | 'quick'
}

export function ReviewShell({ reviewId, prUrl, mode = 'full' }: Props) {
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [findings, setFindings] = useState<Finding[]>([])
  const [decisions, setDecisions] = useState<Record<string, FindingDecision>>(
    {}
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)
  const [phaseStatuses, setPhaseStatuses] = useState<
    Record<string, PhaseStatus>
  >({
    INPUT: 'running',
    CONTEXT: 'pending',
    DOMAIN: 'pending',
    OUTPUT: 'pending',
  })
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [isCachedReview, setIsCachedReview] = useState(false)
  const [runStats, setRunStats] = useState<{
    tokensUsed: number
    estimatedCostUsd: number
    durationMs: number
    findingsCount: number
    phaseDurations: Record<string, number>
  } | null>(null)
  const startTimeRef = useRef(Date.now())
  const domainDoneRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const activityEndRef = useRef<HTMLDivElement | null>(null)
  const activitySeqRef = useRef(0)

  // Tick elapsed while running — skip for cache replays (no meaningful duration)
  useEffect(() => {
    if (status !== 'running' || isCachedReview) return
    const t = setInterval(
      () => setElapsed(Date.now() - startTimeRef.current),
      1000
    )
    return () => clearInterval(t)
  }, [status, isCachedReview])

  // Auto-scroll activity log
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activity])

  function addActivity(entry: Omit<ActivityEntry, 'id'>) {
    setActivity(prev => [...prev, { ...entry, id: ++activitySeqRef.current }])
  }

  useEffect(() => {
    const es = new EventSource(
      `/api/review/${reviewId}?prUrl=${encodeURIComponent(prUrl)}&mode=${mode}`
    )
    esRef.current = es

    es.addEventListener('connected', e => {
      const data = JSON.parse((e as MessageEvent).data ?? '{}')
      setStatus('running')
      addActivity({
        type: 'phase',
        text: data.cached
          ? '⚡ Loaded from cache'
          : '⚡ Connected to review stream',
      })
      if (data.cached) setIsCachedReview(true)
    })

    es.addEventListener('checkpoint', e => {
      const data = JSON.parse(e.data)
      if (data.stage === 'INPUT') {
        setPhaseStatuses(p => ({ ...p, INPUT: 'done', CONTEXT: 'running' }))
        addActivity({
          type: 'phase',
          text: '✓ Input validated — starting context agent',
        })
      } else if (data.stage === 'CONTEXT') {
        setPhaseStatuses(p => ({ ...p, CONTEXT: 'done', DOMAIN: 'running' }))
        addActivity({
          type: 'phase',
          text: '✓ Context gathered — running domain agents',
        })
      } else if (data.stage === 'DOMAIN') {
        const agentName =
          typeof data.agentName === 'string' ? data.agentName : 'unknown'
        addActivity({ type: 'phase', text: `✓ ${agentName} agent complete` })
        domainDoneRef.current += 1
        if (domainDoneRef.current >= 2) {
          setPhaseStatuses(p => ({ ...p, DOMAIN: 'done', OUTPUT: 'running' }))
          addActivity({
            type: 'phase',
            text: '✓ Both domain agents done — generating summary',
          })
        }
      } else if (data.stage === 'OUTPUT') {
        setPhaseStatuses(p => ({ ...p, OUTPUT: 'done' }))
      }
    })

    es.addEventListener('progress', e => {
      const data = JSON.parse(e.data)
      addActivity({
        type: 'tool',
        text: formatTool(
          data.tool,
          (data.args ?? {}) as Record<string, unknown>
        ),
      })
    })

    es.addEventListener('finding', e => {
      const finding: Finding = JSON.parse(e.data).finding
      setFindings(prev => [...prev, finding])
      setDecisions(prev => ({
        ...prev,
        [finding.id]: {
          findingId: finding.id,
          accepted: finding.severity !== 'NIT',
        },
      }))
      addActivity({
        type: 'finding',
        text: `● [${finding.severity}] ${finding.title}`,
      })
    })

    es.addEventListener('alarm', e => {
      const data = JSON.parse(e.data)
      addActivity({
        type: 'alarm',
        text: `⚠ Alarm: ${data.alarm?.type ?? 'unknown'}`,
      })
    })

    es.addEventListener('done', () => {
      setStatus('done')
      setElapsed(Date.now() - startTimeRef.current)
      addActivity({ type: 'phase', text: '🎉 Review complete' })
      es.close()
    })

    es.addEventListener('stats', e => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setRunStats(data)
      } catch {
        // malformed stats payload — degrade gracefully, don't crash the handler
      }
    })

    es.addEventListener('error', e => {
      const msg = (e as MessageEvent).data
        ? JSON.parse((e as MessageEvent).data).error
        : 'Unknown error'
      addActivity({ type: 'alarm', text: `✗ Error: ${msg}` })
      setStatus('error')
    })

    es.onerror = () => {
      setStatus('error')
      es.close()
    }

    return () => es.close()
  }, [reviewId])

  function toggle(id: string) {
    setDecisions(prev => ({
      ...prev,
      [id]: { ...prev[id], accepted: !prev[id].accepted },
    }))
  }

  function startEdit(finding: Finding) {
    setEditingId(finding.id)
    const d = decisions[finding.id]
    setEditTitle(d?.editedTitle ?? finding.title)
    setEditBody(d?.editedBody ?? finding.body)
  }

  function saveEdit(id: string) {
    const finding = findings.find(f => f.id === id)
    setDecisions(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        editedTitle:
          editTitle !== finding?.title ? editTitle || undefined : undefined,
        editedBody:
          editBody !== finding?.body ? editBody || undefined : undefined,
      },
    }))
    setEditingId(null)
  }

  async function handleSubmit(postComment: boolean) {
    setSubmitting(true)
    setSubmitResult(null) // clear any previous error before retry
    try {
      const body = {
        decisions: Object.values(decisions).map(d => ({
          findingId: d.findingId,
          action: d.accepted
            ? d.editedTitle || d.editedBody
              ? 'EDIT'
              : 'ACCEPT'
            : 'REJECT',
          editedTitle: d.editedTitle,
          editedBody: d.editedBody,
        })),
        postComment,
      }
      const res = await fetch(`/api/review/${reviewId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setSubmitResult(
        res.ok
          ? `Submitted: ${data.summary.accepted} accepted, ${data.summary.rejected} rejected`
          : `Error: ${data.error}`
      )
      if (res.ok) setSubmitted(true)
    } catch {
      setSubmitResult('Error: unexpected server response')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove(postComment: boolean) {
    setSubmitting(true)
    setSubmitResult(null) // clear any previous error before retry
    try {
      const res = await fetch(`/api/review/${reviewId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: [], postComment, approve: true }),
      })
      const data = await res.json()
      setSubmitResult(
        res.ok
          ? postComment
            ? '✓ Approved — LGTM comment posted to GitHub'
            : '✓ Marked as approved'
          : `Error: ${data.error}`
      )
      if (res.ok) setSubmitted(true)
    } catch {
      setSubmitResult('Error: unexpected server response')
    } finally {
      setSubmitting(false)
    }
  }
  const accepted = Object.values(decisions).filter(d => d.accepted).length
  const total = findings.length

  return (
    <div className="flex gap-6">
      {/* ── Main panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">PR Review</h1>
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-sm text-indigo-400 hover:underline"
            >
              {prUrl}
            </a>
          )}
          <p className="mt-1 text-xs text-gray-500 font-mono">
            review/{reviewId}
          </p>
        </div>

        {/* Status bar */}
        <div className="mb-4 flex items-center gap-3">
          <StatusIndicator status={status} />
          {mode === 'quick' && (
            <span className="rounded-full bg-indigo-900/50 border border-indigo-700 px-2 py-0.5 text-xs font-semibold text-indigo-300">
              ⚡ Quick
            </span>
          )}
          {status === 'done' && total > 0 && (
            <span className="text-sm text-gray-400">
              {total} finding{total !== 1 ? 's' : ''} — {accepted} accepted
            </span>
          )}
        </div>

        {/* Findings placeholder while running */}
        {findings.length === 0 && status !== 'done' && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-500">
            {status === 'connecting'
              ? 'Connecting to review stream…'
              : 'Agents are running — findings will appear here'}
          </div>
        )}

        {findings.length === 0 && status === 'done' && (
          <div className="rounded-lg border border-green-800 bg-green-950/30 p-8 text-center text-sm text-green-400">
            No findings — clean review!
          </div>
        )}

        <div className="flex flex-col gap-3">
          {findings.map(f => {
            const decision = decisions[f.id]
            const isEditing = editingId === f.id

            return (
              <div
                key={f.id}
                className={`rounded-lg border p-4 transition-opacity ${SEVERITY_STYLES[f.severity]} ${decision?.accepted === false ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {f.file}
                      {f.line ? `:${f.line}` : ''}
                    </span>
                    <span className="text-xs text-gray-500">{f.category}</span>
                    <span className="text-xs text-gray-600">
                      {Math.round(f.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={decision?.accepted ?? true}
                        onChange={() => toggle(f.id)}
                      />
                      <span className="text-xs text-gray-400">Include</span>
                    </label>
                  </div>
                </div>

                <p className="mt-2 text-sm font-medium text-gray-100">
                  {decisions[f.id]?.editedTitle ? (
                    <span className="text-indigo-300">
                      {decisions[f.id].editedTitle}
                    </span>
                  ) : (
                    f.title
                  )}
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  {decisions[f.id]?.editedBody ?? f.body}
                </p>

                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">
                        Title
                      </label>
                      <input
                        type="text"
                        className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">
                        Description
                      </label>
                      <textarea
                        className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        rows={4}
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(f.id)}
                        className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {f.suggestedFix && (
                      <p className="mt-2 rounded bg-gray-800 px-3 py-2 font-mono text-xs text-green-400">
                        {f.suggestedFix}
                      </p>
                    )}
                    <button
                      onClick={() => startEdit(f)}
                      className="mt-2 text-xs text-indigo-400 hover:underline"
                    >
                      Edit suggestion
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Submit controls */}
        {status === 'done' && total > 0 && (
          <div className="mt-6">
            {submitted ? (
              <p className="rounded-lg border border-green-700 bg-green-950/40 px-4 py-2.5 text-sm font-medium text-green-400">
                {submitResult}
              </p>
            ) : (
              <button
                disabled={submitting}
                onClick={() => handleSubmit(true)}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : `Submit + Post to GitHub (${accepted}/${total})`}
              </button>
            )}
          </div>
        )}

        {/* Clean review: no findings → Approve CTA */}
        {status === 'done' && total === 0 && (
          <div className="mt-6">
            {submitted ? (
              <p className="rounded-lg border border-green-700 bg-green-950/40 px-4 py-2.5 text-sm font-medium text-green-400">
                {submitResult}
              </p>
            ) : (
              <button
                disabled={submitting}
                onClick={() => handleApprove(true)}
                className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50"
              >
                {submitting ? 'Approving…' : '✓ Approve PR on GitHub'}
              </button>
            )}
          </div>
        )}

        {/* Error result (only shown when not yet submitted successfully) */}
        {submitResult && !submitted && (
          <p className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-red-400">
            {submitResult}
          </p>
        )}
      </div>

      {/* ── Activity sidebar ───────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 hidden lg:block">
        <div className="sticky top-4 space-y-4">
          {/* Pipeline stages */}
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Pipeline
              </h2>
              <span
                className={`text-xs font-mono tabular-nums ${status === 'done' ? 'text-green-500' : 'text-gray-500'}`}
              >
                {isCachedReview ? '⚡ cache' : formatElapsed(elapsed)}
              </span>
            </div>
            <div className="space-y-2">
              {PIPELINE.map(({ key, label }) => {
                const skipped = mode === 'quick' && key === 'CONTEXT'
                return (
                  <PhaseRow
                    key={key}
                    label={skipped ? `${label} (skipped)` : label}
                    status={skipped ? 'pending' : (phaseStatuses[key] ?? 'pending')}
                    dimmed={skipped}
                  />
                )
              })}
            </div>
            {runStats && (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <p className="text-xs font-mono text-gray-500 tabular-nums">
                  {runStats.tokensUsed.toLocaleString()} tokens
                  {' · '}
                  ${runStats.estimatedCostUsd.toFixed(4)}
                  {' · '}
                  {formatElapsed(runStats.durationMs)}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {Object.entries(runStats.phaseDurations ?? {}).map(([phase, ms]) => (
                    <div key={phase} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-16">{phase}</span>
                      <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full"
                          style={{
                            width: `${runStats.durationMs > 0 ? Math.min(100, (ms / runStats.durationMs) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-600 font-mono tabular-nums w-12 text-right">
                        {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Activity feed */}
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Activity
            </h2>
            <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
              {activity.length === 0 ? (
                <p className="text-xs text-gray-600">Waiting for events…</p>
              ) : (
                activity.map(item => (
                  <p
                    key={item.id}
                    className={`text-xs font-mono leading-snug ${
                      item.type === 'alarm'
                        ? 'text-red-400'
                        : item.type === 'finding'
                          ? 'text-yellow-400'
                          : item.type === 'phase'
                            ? 'text-green-400'
                            : 'text-gray-400'
                    }`}
                  >
                    {item.text}
                  </p>
                ))
              )}
              <div ref={activityEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: StreamStatus }) {
  const configs: Record<StreamStatus, { dot: string; label: string }> = {
    connecting: { dot: 'bg-yellow-400 animate-pulse', label: 'Connecting' },
    running: { dot: 'bg-green-400 animate-pulse', label: 'Agents running' },
    done: { dot: 'bg-indigo-400', label: 'Complete' },
    error: { dot: 'bg-red-500', label: 'Stream error' },
  }
  const { dot, label } = configs[status]
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  )
}

function PhaseRow({
  label,
  status,
  dimmed = false,
}: {
  label: string
  status: PhaseStatus
  dimmed?: boolean
}) {
  return (
    <div className={`flex items-center gap-2.5 ${dimmed ? 'opacity-35' : ''}`}>
      <PhaseIcon status={status} />
      <span
        className={`text-xs ${
          status === 'done'
            ? 'text-gray-300'
            : status === 'running'
              ? 'text-white font-medium'
              : 'text-gray-600'
        }`}
      >
        {label}
      </span>
      {status === 'running' && (
        <span className="ml-auto text-xs text-indigo-400 animate-pulse">
          running
        </span>
      )}
      {status === 'done' && (
        <span className="ml-auto text-xs text-green-600">done</span>
      )}
    </div>
  )
}

function PhaseIcon({ status }: { status: PhaseStatus }) {
  if (status === 'done')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-700 text-green-100 text-[9px] font-bold">
        ✓
      </span>
    )
  if (status === 'running')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    )
  if (status === 'error')
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-700 text-red-100 text-[9px] font-bold">
        ✗
      </span>
    )
  // pending
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-700" />
  )
}
