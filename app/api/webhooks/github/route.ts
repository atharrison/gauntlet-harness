import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRoleClient } from '../../../../src/lib/supabase/server'
import { verifyGitHubSignature } from '../../../../src/lib/webhook'

/**
 * GitHub pull_request webhook payload (the fields we care about).
 */
interface GitHubPrPayload {
  action?: string
  pull_request?: {
    number: number
    title: string
    html_url: string
    state: string
    user: { login: string }
    created_at: string
    closed_at: string | null
  }
  repository?: {
    name: string
    owner: { login: string }
  }
}

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub `pull_request` webhook events and keeps `tracked_prs` in sync:
 *   opened / reopened → upsert with status=OPEN, source=WEBHOOK
 *   closed            → update status=CLOSED, pr_closed_at, updated_since_review=false
 *   synchronize       → flip REVIEWED → OPEN and set updated_since_review=true
 *
 * Returns 204 for unrecognised event types or ignored actions.
 * Returns 401 for any authentication/authorization failure (signature missing or
 * invalid, secret not configured, or repo not found) — all failure modes return
 * the same status code to prevent repo existence enumeration.
 */
export async function POST(request: NextRequest) {
  const event = request.headers.get('x-github-event')

  // Only care about pull_request events
  if (event !== 'pull_request') {
    return new NextResponse(null, { status: 204 })
  }

  // Reject immediately if no signature header — no DB call needed.
  const signature = request.headers.get('x-hub-signature-256')
  if (!signature) {
    return NextResponse.json(
      { error: 'Missing webhook signature' },
      { status: 401 }
    )
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

  // DB lookup using attacker-supplied owner/repo to obtain the per-repo secret.
  // This ordering dependency is inherent to the per-repo secret design: we must
  // identify the repo before we can retrieve its secret for HMAC verification.
  // The HMAC is computed over rawBody (not parsed fields), so forged owner/repo
  // values in the payload only affect which secret is fetched — the signature
  // check still fails unless the caller knows that repo's actual secret.
  // Return 401 (not 404) for unknown repos to prevent existence enumeration.
  const { data: configuredRepo, error: repoLookupError } = await service
    .from('configured_repos')
    .select('id, webhook_secret')
    .eq('owner', owner)
    .eq('name', repo)
    .single()

  if (repoLookupError || !configuredRepo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A repo without a secret is misconfigured — reject rather than bypass HMAC.
  const webhookSecret: string | null = configuredRepo.webhook_secret
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Webhook secret not configured for this repository' },
      { status: 401 }
    )
  }

  if (!verifyGitHubSignature(rawBody, webhookSecret, signature)) {
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 401 }
    )
  }

  const action = payload.action
  if (!action) {
    return NextResponse.json(
      { error: 'Missing action in payload' },
      { status: 400 }
    )
  }

  const pr = payload.pull_request
  if (!pr) {
    return NextResponse.json(
      { error: 'Missing pull_request in payload' },
      { status: 400 }
    )
  }

  const prNumber = pr.number
  const prUrl = pr.html_url
  const prTitle = pr.title
  const prAuthor = pr.user?.login ?? null
  const prOpenedAt = pr.created_at

  if (action === 'opened' || action === 'reopened') {
    const baseFields = {
      owner,
      repo,
      pr_number: prNumber,
      pr_url: prUrl,
      pr_title: prTitle,
      pr_author: prAuthor,
      pr_opened_at: prOpenedAt,
      pr_closed_at: null,
      status: 'OPEN',
      source: 'WEBHOOK',
    }
    // For a brand-new PR (opened) initialise the flag to false — no review yet.
    // For reopened, omit the field so Supabase preserves whatever value is already
    // stored: a REVIEWED PR that was closed and then reopened after new commits
    // should retain updated_since_review=true so it surfaces for re-review.
    const upsertData =
      action === 'opened'
        ? { ...baseFields, updated_since_review: false }
        : baseFields

    const { error } = await service
      .from('tracked_prs')
      .upsert(upsertData, {
        onConflict: 'owner,repo,pr_number',
        ignoreDuplicates: false,
      })

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
    const { data: updated, error } = await service
      .from('tracked_prs')
      .update({
        status: 'CLOSED',
        pr_closed_at: prClosedAt,
        updated_since_review: false,
      })
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('pr_number', prNumber)
      .select('id')

    if (error) {
      console.error('[POST /api/webhooks/github] update error (closed)', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
    const matched = Array.isArray(updated) ? updated.length : 0
    if (matched === 0) {
      console.warn(
        `[POST /api/webhooks/github] closed event for untracked PR ${owner}/${repo}#${prNumber}`
      )
    }
    return NextResponse.json({ ok: true, action, matched })
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
