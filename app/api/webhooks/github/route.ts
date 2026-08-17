import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRoleClient } from '../../../../src/lib/supabase/server'
import { verifyGitHubSignature } from '../../../../src/lib/webhook'

/**
 * GitHub pull_request webhook payload (the fields we care about).
 */
interface GitHubPrPayload {
  action: string
  number: number
  pull_request: {
    number: number
    title: string
    html_url: string
    state: string
    user: { login: string }
    created_at: string
    closed_at: string | null
  }
  repository: {
    name: string
    owner: { login: string }
  }
}

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub `pull_request` webhook events and keeps `tracked_prs` in sync:
 *   opened / reopened → upsert with status=OPEN, source=WEBHOOK
 *   closed            → update status=CLOSED, pr_closed_at
 *   synchronize       → flip REVIEWED → OPEN and set updated_since_review=true
 *
 * Returns 204 for unrecognised event types or ignored actions.
 * Returns 401 when the HMAC signature is invalid (and a webhook_secret is set).
 * Returns 404 when the repository is not in configured_repos.
 */
export async function POST(request: NextRequest) {
  const event = request.headers.get('x-github-event')

  // Only care about pull_request events
  if (event !== 'pull_request') {
    return new NextResponse(null, { status: 204 })
  }

  const rawBody = await request.text()

  let payload: GitHubPrPayload
  try {
    payload = JSON.parse(rawBody) as GitHubPrPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  if (!owner || !repo) {
    return NextResponse.json(
      { error: 'Missing repository info in payload' },
      { status: 400 }
    )
  }

  const service = createSupabaseServiceRoleClient()

  // Look up the repo to get webhook_secret (and confirm it is configured)
  const { data: configuredRepo, error: repoLookupError } = await service
    .from('configured_repos')
    .select('id, webhook_secret')
    .eq('owner', owner)
    .eq('name', repo)
    .single()

  if (repoLookupError || !configuredRepo) {
    return NextResponse.json(
      { error: 'Repository not configured' },
      { status: 404 }
    )
  }

  // HMAC validation — enforced only when the repo has a webhook_secret set
  const webhookSecret: string | null = configuredRepo.webhook_secret
  if (webhookSecret) {
    const signature = request.headers.get('x-hub-signature-256')
    if (!verifyGitHubSignature(rawBody, webhookSecret, signature)) {
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      )
    }
  }

  const { action, pull_request: pr } = payload
  const prNumber = pr.number
  const prUrl = pr.html_url
  const prTitle = pr.title
  const prAuthor = pr.user?.login ?? null
  const prOpenedAt = pr.created_at

  if (action === 'opened' || action === 'reopened') {
    const { error } = await service.from('tracked_prs').upsert(
      {
        owner,
        repo,
        pr_number: prNumber,
        pr_url: prUrl,
        pr_title: prTitle,
        pr_author: prAuthor,
        pr_opened_at: prOpenedAt,
        pr_closed_at: null,
        status: 'OPEN',
        updated_since_review: false,
        source: 'WEBHOOK',
      },
      { onConflict: 'owner,repo,pr_number', ignoreDuplicates: false }
    )

    if (error) {
      console.error(
        `[POST /api/webhooks/github] upsert error (${action})`,
        error
      )
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: true, action })
  }

  if (action === 'closed') {
    const prClosedAt = pr.closed_at ?? new Date().toISOString()
    const { error } = await service
      .from('tracked_prs')
      .update({ status: 'CLOSED', pr_closed_at: prClosedAt })
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('pr_number', prNumber)

    if (error) {
      console.error('[POST /api/webhooks/github] update error (closed)', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: true, action })
  }

  if (action === 'synchronize') {
    // Only flip back PRs that are already REVIEWED; other statuses are unaffected.
    const { error } = await service
      .from('tracked_prs')
      .update({ status: 'OPEN', updated_since_review: true })
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('pr_number', prNumber)
      .eq('status', 'REVIEWED')

    if (error) {
      console.error(
        '[POST /api/webhooks/github] update error (synchronize)',
        error
      )
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: true, action })
  }

  // Unrecognised action (labeled, edited, assigned, etc.) — acknowledge and ignore
  return new NextResponse(null, { status: 204 })
}
