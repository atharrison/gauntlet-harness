import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { createSupabaseServerClient } from '../src/lib/supabase/server'
import UserMenu from './components/UserMenu'

export const metadata: Metadata = {
  title: 'PR Review Harness',
  description: 'AI-assisted PR review with multi-agent orchestration',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <Link
              href="/"
              className="text-xl font-semibold tracking-tight hover:text-indigo-300 transition-colors"
            >
              PR Review Harness
            </Link>
            <span className="rounded bg-indigo-900 px-2 py-0.5 text-xs font-medium text-indigo-300">
              BETA
            </span>
            <nav className="ml-4 flex items-center gap-5">
              <Link
                href="/architecture"
                className="text-sm text-gray-400 transition-colors hover:text-gray-200"
              >
                Architecture
              </Link>
              <Link
                href="/blog"
                className="text-sm text-gray-400 transition-colors hover:text-gray-200"
              >
                Blog
              </Link>
            </nav>
            {user && <UserMenu user={user} />}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
