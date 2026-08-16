'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AddPrForm() {
  const router = useRouter()
  const [prUrl, setPrUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to add PR')
        return
      }

      const pr = data.pr
      setSuccess(
        `Added: ${pr.owner}/${pr.repo} #${pr.pr_number}${pr.pr_title ? ` — ${pr.pr_title}` : ''}`
      )
      setPrUrl('')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
    >
      <input
        type="url"
        value={prUrl}
        onChange={e => setPrUrl(e.target.value)}
        placeholder="https://github.com/owner/repo/pull/123"
        required
        className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {loading ? 'Adding…' : '+ Track PR'}
      </button>

      {error && (
        <p className="w-full rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-400 sm:col-span-2">
          {error}
        </p>
      )}
      {success && (
        <p className="w-full rounded-lg border border-green-800 bg-green-950/30 px-3 py-2 text-sm text-green-400 sm:col-span-2">
          ✓ {success}
        </p>
      )}
    </form>
  )
}
