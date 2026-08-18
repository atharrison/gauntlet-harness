'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface TrackedPr {
  id: string
  owner: string
  repo: string
  pr_number: number
  pr_url: string
  pr_title: string | null
  pr_author: string | null
  pr_opened_at: string | null
  status: string
  updated_since_review: boolean
  review_count: number
  created_at: string
}

type RepoGroup = { key: string; owner: string; repo: string; prs: TrackedPr[] }

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  OPEN: {
    label: 'Open',
    className: 'bg-blue-900/50 text-blue-300 border-blue-800',
  },
  IN_REVIEW: {
    label: 'In Review',
    className: 'bg-yellow-900/50 text-yellow-300 border-yellow-800',
  },
  REVIEWED: {
    label: 'Reviewed',
    className: 'bg-green-900/50 text-green-300 border-green-800',
  },
  CLOSED: {
    label: 'Closed',
    className: 'bg-gray-800/80 text-gray-500 border-gray-700',
  },
}

function StatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE['OPEN']
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  )
}

function groupByRepo(prs: TrackedPr[]): RepoGroup[] {
  const map = new Map<string, RepoGroup>()
  for (const pr of prs) {
    const key = `${pr.owner}/${pr.repo}`
    if (!map.has(key)) {
      map.set(key, { key, owner: pr.owner, repo: pr.repo, prs: [] })
    }
    map.get(key)!.prs.push(pr)
  }
  return Array.from(map.values())
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type StatusFilter = 'ALL' | 'OPEN' | 'IN_REVIEW' | 'REVIEWED' | 'CLOSED'

const FILTER_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'REVIEWED', label: 'Reviewed' },
  { value: 'CLOSED', label: 'Closed' },
]

export default function QueueDisplay({
  initialPrs,
}: {
  initialPrs: TrackedPr[]
  userName?: string
}) {
  const router = useRouter()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set())
  const [startError, setStartError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  async function handleStartReview(pr: TrackedPr) {
    setStartingIds(prev => new Set(prev).add(pr.id))
    setStartError(null)
    try {
      const res = await fetch('/api/review/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prUrl: pr.pr_url }),
      })
      if (!res.ok) {
        console.error('[QueueDisplay] review start failed', await res.text())
        setStartError('Failed to start review — please try again.')
        return
      }
      const { reviewId } = (await res.json()) as { reviewId: string }
      // Validate before using in navigation to guard against unexpected server responses
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          reviewId
        )
      ) {
        console.error('[QueueDisplay] unexpected reviewId format', reviewId)
        setStartError('Unexpected server response — please try again.')
        return
      }
      router.push(`/review/${reviewId}?prUrl=${encodeURIComponent(pr.pr_url)}`)
    } catch (err) {
      console.error('[QueueDisplay] review start error', err)
      setStartError('Failed to start review — please try again.')
    } finally {
      setStartingIds(prev => {
        const next = new Set(prev)
        next.delete(pr.id)
        return next
      })
    }
  }

  async function handleRemove(pr: TrackedPr) {
    if (
      !confirm(`Remove ${pr.owner}/${pr.repo} #${pr.pr_number} from the queue?`)
    )
      return
    setRemovingId(pr.id)
    try {
      await fetch(`/api/queue/${pr.id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setRemovingId(null)
    }
  }

  const filteredPrs =
    statusFilter === 'ALL'
      ? initialPrs
      : initialPrs.filter(pr => pr.status === statusFilter)

  const groups = groupByRepo(filteredPrs)

  const filterBar = (
    <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      {FILTER_TABS.map(tab => {
        const count =
          tab.value === 'ALL'
            ? initialPrs.length
            : initialPrs.filter(p => p.status === tab.value).length
        const active = statusFilter === tab.value
        return (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? 'bg-gray-600 text-gray-200' : 'text-gray-600'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  if (initialPrs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 py-16 text-center">
        <p className="text-gray-500">No PRs tracked yet.</p>
        <p className="mt-1 text-sm text-gray-600">
          Paste a GitHub PR URL above to add one, or configure webhooks in
          Settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {filterBar}
      {startError && (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-400">
          {startError}
        </div>
      )}
      {groups.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">
          No {statusFilter.toLowerCase().replace('_', ' ')} PRs.
        </p>
      )}
      {groups.map(group => (
        <section key={group.key}>
          <div className="mb-2 flex items-center gap-2">
            <a
              href={`https://github.com/${group.owner}/${group.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-gray-200 transition hover:text-indigo-300"
            >
              {group.owner}/{group.repo}
            </a>
            <span className="text-xs text-gray-600">
              {group.prs.length} PR{group.prs.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-900">
            {group.prs.map(pr => {
              const isRemoving = removingId === pr.id
              const isStarting = startingIds.has(pr.id)
              const isClosed = pr.status === 'CLOSED'
              const isReviewed = pr.status === 'REVIEWED'
              const isOpen = pr.status === 'OPEN'

              return (
                <div
                  key={pr.id}
                  className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4 ${isClosed ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={pr.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-white transition hover:text-indigo-300"
                      >
                        #{pr.pr_number}
                        {pr.pr_title && (
                          <span className="ml-1.5 font-normal text-gray-300">
                            {pr.pr_title}
                          </span>
                        )}
                      </a>
                      <StatusBadge status={pr.status} />
                      {pr.updated_since_review && (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-800 bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-300">
                          ⟳ Updated
                        </span>
                      )}
                      {pr.review_count > 0 && (
                        <span className="text-xs text-gray-600">
                          {pr.review_count} review
                          {pr.review_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                      {pr.pr_author && <span>@{pr.pr_author}</span>}
                      {pr.pr_opened_at && (
                        <span>opened {formatDate(pr.pr_opened_at)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {(isOpen || pr.updated_since_review) && !isClosed && (
                      <button
                        onClick={() => handleStartReview(pr)}
                        disabled={isStarting}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {isStarting
                          ? '…'
                          : isReviewed
                            ? 'Re-review'
                            : 'Start Review'}
                      </button>
                    )}
                    {isReviewed && !pr.updated_since_review && (
                      <button
                        onClick={() => handleStartReview(pr)}
                        disabled={isStarting}
                        className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:border-gray-600 hover:text-gray-200 disabled:opacity-50"
                      >
                        {isStarting ? '…' : 'Re-review'}
                      </button>
                    )}
                    {pr.status === 'IN_REVIEW' && (
                      <span className="rounded-md border border-yellow-800 px-3 py-1.5 text-xs font-medium text-yellow-400">
                        Reviewing…
                      </span>
                    )}
                    <button
                      onClick={() => handleRemove(pr)}
                      disabled={isRemoving}
                      className="rounded-md border border-gray-800 px-2.5 py-1.5 text-xs text-gray-600 transition hover:border-red-900 hover:text-red-400 disabled:opacity-50"
                      aria-label="Remove from queue"
                    >
                      {isRemoving ? '…' : '×'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
