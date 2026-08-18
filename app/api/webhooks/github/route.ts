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
 *   opened    → upsert (idempotent); initialises updated_since_review=false
 *   reopened  → update only (preserves updated_since_review and source)
 *   closed            → update status=CLOSED, pr_closed_at, updated_since_review=false
 *   synchronize       → flip REVIEWED → OPEN and set updated_since_review=true
 *
 * Returns 204 for unrecognised event types or ignored actions.
 * Returns 401 for any authentication/authorization failure (signature missing or
 * invalid, secret not configured, or repo not found) — all failure modes return
 * the same status code to prevent repo existence enumeration.
 */
export async function POST(request: NextRequest) {
  // Reject immediately if no signature header — no DB call needed.
  // This gate runs before the event-type check so that non-pull_request events
  // (ping, push, etc.) are also rejected when unauthenticated, preventing
  // unauthenticated callers from probing the endpoint with arbitrary events.
  // Full HMAC verification of these events is skipped because we don't need
  // the payload to process them — returning 204 is sufficient acknowledgement
  // for events we intentionally ignore.
  const signature = request.headers.get('x-hub-signature-256')
  if (!signature) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  // All 401 paths return the same generic body so callers cannot distinguish
  // unknown-repo from bad-signature from missing-secret via response content.
  const webhookSecret: string | null = configuredRepo.webhook_secret
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!verifyGitHubSignature(rawBody, webhookSecret, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  if (action === 'opened') {
    // Upsert so duplicate webhook deliveries are idempotent.
    // Explicitly initialise updated_since_review=false — no review exists yet.
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
      console.error('[POST /api/webhooks/github] upsert error (opened)', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: true, action })
  }

  if (action === 'reopened') {
    // Use update (not upsert) so we only touch the fields that should change.
    // updated_since_review is intentionally omitted: a REVIEWED PR reopened after
    // new commits must retain updated_since_review=true so it surfaces for re-review.
    // source is intentionally omitted: a manually-added PR must retain source=MANUAL.
    const { error } = await service
      .from('tracked_prs')
      .update({
        status: 'OPEN',
        pr_url: prUrl,
        pr_title: prTitle,
        pr_author: prAuthor,
        pr_opened_at: prOpenedAt,
        pr_closed_at: null,
      })
      .eq('owner', owner)
      .eq('repo', repo)
      .eq('pr_number', prNumber)

    if (error) {
      console.error(
        '[POST /api/webhooks/github] update error (reopened)',
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
    // Intentional no-op for untracked PRs: if the PR was never in tracked_prs,
    // the update matches zero rows, error is null, and matched=0 is returned.
    // A console.warn is emitted so operators can detect misconfiguration.
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
    // Only flip back PRs that are already REVIEWED; other statuses are intentional
    // no-ops. A PR in OPEN status already has no review to invalidate. A PR in
    // IN_REVIEW status will be evaluated against the latest commits naturally.
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
