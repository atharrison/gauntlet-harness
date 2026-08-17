import { type NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
  getGitHubToken,
} from '../../../src/lib/supabase/server'
import { parsePrUrl } from '../../../src/lib/queue'

/**
 * GET /api/queue
 * Returns all tracked_prs, ordered by created_at desc.
 * Optionally filter by ?status=OPEN|IN_REVIEW|REVIEWED|CLOSED
 */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')

  const service = createSupabaseServiceRoleClient()
  let query = service
    .from('tracked_prs')
    .select('*')
    .order('created_at', { ascending: false })
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data, error } = await query
  if (error) {
    console.error('[GET /api/queue]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  return NextResponse.json({ prs: data })
}

/**
 * POST /api/queue
 * Body: { prUrl: string }
 * Parses the PR URL (github.com/owner/repo/pull/number), fetches metadata from
 * GitHub via Octokit if available, and upserts into tracked_prs.
 * Returns the upserted row.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { prUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { prUrl } = body
  if (!prUrl) {
    return NextResponse.json({ error: 'prUrl is required' }, { status: 400 })
  }

  const parsed = parsePrUrl(prUrl)
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Invalid GitHub PR URL. Expected: https://github.com/owner/repo/pull/number',
      },
      { status: 400 }
    )
  }
  const { owner, repo, pr_number, canonical_url } = parsed

  // Attempt to fetch PR metadata from GitHub (best-effort)
  let pr_title: string | null = null
  let pr_author: string | null = null
  let pr_opened_at: string | null = null
  let pr_closed_at: string | null = null
  let detectedStatus: 'OPEN' | 'CLOSED' = 'OPEN'

  try {
    const { Octokit } = await import('@octokit/rest')
    const token = process.env.GITHUB_TOKEN ?? (await getGitHubToken())
    if (token) {
      const octokit = new Octokit({ auth: token })
      const { data: prData } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pr_number,
      })
      pr_title = prData.title
      pr_author = prData.user?.login ?? null
      pr_opened_at = prData.created_at
      pr_closed_at = prData.closed_at ?? null
      detectedStatus = prData.state === 'open' ? 'OPEN' : 'CLOSED'
    }
  } catch {
    // Non-fatal — we still add the PR with the info we have
  }

  const service = createSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('tracked_prs')
    .upsert(
      {
        owner,
        repo,
        pr_number,
        pr_url: canonical_url,
        pr_title,
        pr_author,
        pr_opened_at,
        pr_closed_at,
        status: detectedStatus,
        source: 'MANUAL',
      },
      { onConflict: 'owner,repo,pr_number', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error) {
    console.error('[POST /api/queue]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  return NextResponse.json({ pr: data }, { status: 201 })
}
