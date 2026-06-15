import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Blog | PR Review Harness',
}

export default function BlogIndexPage() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="mb-10 text-3xl font-bold tracking-tight text-white">Blog</h1>
      <Link
        href="/blog/after-fired-festival"
        className="group block rounded-xl border border-gray-800 bg-gray-900 p-6 transition hover:border-gray-700"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Fired Festival · June 14, 2026
        </p>
        <h2 className="mb-2 text-xl font-semibold text-white group-hover:text-indigo-300 transition-colors">
          After Fired Festival
        </h2>
        <p className="text-sm text-gray-400">
          A first-place finish at the 2026 Fired Festival AI hackathon, and what it meant.
        </p>
      </Link>
    </div>
  )
}
