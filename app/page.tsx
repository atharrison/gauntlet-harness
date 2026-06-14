'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [prUrl, setPrUrl] = useState('')
  const [quickMode, setQuickMode] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl, mode: quickMode ? 'quick' : 'full', password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to start review')
        return
      }
      const dest = `/review/${data.reviewId}?prUrl=${encodeURIComponent(data.prUrl ?? prUrl)}&mode=${data.mode ?? (quickMode ? 'quick' : 'full')}`
      router.push(dest)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="mb-3 text-4xl font-bold tracking-tight text-white">
        AI PR Review Harness
      </h1>
      <p className="mb-10 max-w-xl text-lg text-gray-400">
        Multi-agent code review with guardrails, checkpoints, and an approval
        workflow. Paste a GitHub PR URL to get started.
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col gap-3"
      >
        <input
          type="url"
          value={prUrl}
          onChange={e => setPrUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
          required
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        {/* Access code row */}
        <div className="flex items-center gap-2">
          {/* Lock icon + tooltip */}
          <div className="group relative flex-shrink-0">
            <span className="cursor-default select-none text-base leading-none text-gray-500 hover:text-gray-300 transition-colors">
              🔒
            </span>
            <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-xs text-gray-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 z-10">
              <p className="font-semibold text-white mb-1">Access required</p>
              <p className="text-gray-400">
                The Fired Festival hackathon is complete and API access is limited.
                To request access, find me on{' '}
                <a
                  href="https://github.com/atharrison"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 underline hover:text-indigo-300"
                  style={{ pointerEvents: 'auto' }}
                >
                  GitHub (@atharrison)
                </a>{' '}
                and I&apos;ll send you an access code.
              </p>
            </div>
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Access code"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Quick mode toggle */}
        <label className="flex cursor-pointer items-center gap-3 self-start rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 hover:border-gray-700 transition-colors">
          <div className="relative">
            <input
              type="checkbox"
              checked={quickMode}
              onChange={e => setQuickMode(e.target.checked)}
              className="sr-only peer"
            />
            <div className="h-5 w-9 rounded-full bg-gray-700 peer-checked:bg-indigo-600 transition-colors" />
            <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-sm text-gray-300">
            <span className="font-semibold text-white">⚡ Quick mode</span>
            <span className="ml-2 text-gray-500">
              {quickMode
                ? 'Correctness + security only (~30s)'
                : 'Full review with context agent (~2 min)'}
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-red-950/40 border border-red-800 px-4 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50"
        >
          {loading ? 'Starting…' : 'Start Review'}
        </button>
      </form>

      <div className="mt-16 grid grid-cols-2 gap-6 text-left sm:grid-cols-4">
        {[
          {
            icon: '🛡️',
            label: 'Guardrails',
            desc: 'Input/output integrity checks',
          },
          {
            icon: '✅',
            label: 'Checkpoints',
            desc: '5 named stages with pass/fail',
          },
          {
            icon: '🔧',
            label: 'Material Handling',
            desc: 'Typed tool dispatch + registry',
          },
          { icon: '🚨', label: 'Alarms', desc: 'Named alerts with severity' },
        ].map(({ icon, label, desc }) => (
          <div
            key={label}
            className="rounded-lg border border-gray-800 bg-gray-900 p-4"
          >
            <div className="mb-1 text-2xl">{icon}</div>
            <div className="text-sm font-semibold text-white">{label}</div>
            <div className="mt-1 text-xs text-gray-500">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
