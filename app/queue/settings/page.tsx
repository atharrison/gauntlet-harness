import Link from 'next/link'
import { createSupabaseServerClient } from '../../../src/lib/supabase/server'
import ReposManager from './ReposManager'

export const dynamic = 'force-dynamic'

export default async function QueueSettingsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: reposData } = await supabase
    .from('configured_repos')
    .select('*')
    .order('owner')
    .order('name')

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/queue"
          className="text-sm text-gray-500 transition hover:text-gray-300"
        >
          ← Queue
        </Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold tracking-tight text-white">
          Settings
        </h1>
      </div>

      <section>
        <h2 className="mb-1 text-base font-semibold text-white">
          Configured Repos
        </h2>
        <p className="mb-4 text-sm text-gray-400">
          Repos registered for PR tracking. PRs are added automatically when a
          webhook fires, or manually from the queue page.
        </p>
        <ReposManager initialRepos={reposData ?? []} />
      </section>
    </div>
  )
}
