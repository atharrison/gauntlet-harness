import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Architecture | PR Review Harness',
  description:
    'One-page architecture overview of the PR Review Agent built at Fired Festival.',
}

export default function ArchitecturePage() {
  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-300"
          >
            ← back to harness
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">
            Architecture One-Pager
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            The design doc defended at Fired Festival — 11:30pm Friday night.
          </p>
        </div>
        <a
          href="/architecture.html"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white"
        >
          Open full page ↗
        </a>
      </div>

      {/* Iframe — renders the self-contained HTML with its own dark styles */}
      <div className="overflow-hidden rounded-xl border border-gray-800 shadow-2xl">
        <iframe
          src="/architecture.html"
          title="PR Review Agent Architecture"
          className="w-full"
          style={{ height: '80vh', minHeight: 600, border: 'none' }}
        />
      </div>

      <p className="mt-4 text-center text-xs text-gray-600">
        Built at Fired Festival · Gauntlet AI Hackathon
      </p>
    </div>
  )
}
