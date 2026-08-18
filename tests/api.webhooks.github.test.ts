/**
 * Unit tests for POST /api/webhooks/github
 *
 * Supabase service-role client is fully mocked; no real DB required.
 * Tests cover:
 *   - Non-pull_request event → 204
 *   - Missing signature header → 401 (before any DB call)
 *   - Repo not configured → 401 (same code as bad signature to prevent enumeration)
 *   - No webhook_secret on repo → 401
 *   - Invalid HMAC → 401
 *   - Missing action or pull_request field in payload → 400
 *   - opened / reopened → 200 + upsert
 *   - closed → 200 + update (clears updated_since_review); matched=0 logged for untracked PRs
 *   - synchronize → 200 + conditional update
 *   - Unrecognised action → 204
 *   - DB error paths → 500
 */

import { NextRequest } from 'next/server'
import { computeGitHubSignature } from '../src/lib/webhook'

// ── Supabase mock setup ────────────────────────────────────────────────────────

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const m of [
    'select',
    'upsert',
    'insert',
    'update',
    'delete',
    'eq',
    'order',
  ]) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  chain.single = jest.fn().mockResolvedValue(result)
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

/** Tracks the most recently created service-role mock client */
let mockServiceFromFn: jest.Mock

jest.mock('../src/lib/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
  createSupabaseServiceRoleClient: jest.fn().mockImplementation(() => ({
    from: mockServiceFromFn,
  })),
  getGitHubToken: jest.fn().mockResolvedValue(null),
  GH_TOKEN_COOKIE: 'gh_provider_token',
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret'
const OWNER = 'acme'
const REPO = 'my-app'

function makeConfiguredRepo(webhookSecret: string | null = WEBHOOK_SECRET) {
  return makeChain({
    data: { id: 'repo-uuid', webhook_secret: webhookSecret },
    error: null,
  })
}

function makeTrackedPrsChain(error: unknown = null) {
  return makeChain({ data: [{ id: 'pr-uuid' }], error })
}

function makeEmptyUpdateChain() {
  return makeChain({ data: [], error: null })
}

function buildPayload(action: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    action,
    number: 42,
    pull_request: {
      number: 42,
      title: 'Fix the bug',
      html_url: `https://github.com/${OWNER}/${REPO}/pull/42`,
      state: action === 'closed' ? 'closed' : 'open',
      user: { login: 'dev' },
      created_at: '2026-08-17T00:00:00Z',
      closed_at: action === 'closed' ? '2026-08-17T01:00:00Z' : null,
      ...overrides,
    },
    repository: {
      name: REPO,
      owner: { login: OWNER },
    },
  })
}

function makeRequest(
  body: string,
  opts: {
    event?: string
    secret?: string | null
    method?: string
  } = {}
) {
  const event = opts.event ?? 'pull_request'
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': event,
  }
  if (opts.secret !== null) {
    const sig = computeGitHubSignature(body, opts.secret ?? WEBHOOK_SECRET)
    headers['x-hub-signature-256'] = sig
  }
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: opts.method ?? 'POST',
    body,
    headers,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/github', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeAll(async () => {
    ;({ POST } = await import('../app/api/webhooks/github/route'))
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Default: mockServiceFromFn is a fresh jest.fn; tests override per-call
    mockServiceFromFn = jest.fn()
  })

  // ── Non pull_request events ────────────────────────────────────────────────

  it('returns 204 for non-pull_request events', async () => {
    const body = JSON.stringify({ action: 'created' })
    const req = makeRequest(body, { event: 'push' })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(mockServiceFromFn).not.toHaveBeenCalled()
  })

  it('returns 204 for ping events', async () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' })
    const req = makeRequest(body, { event: 'ping' })
    const res = await POST(req)
    expect(res.status).toBe(204)
  })

  // ── Invalid JSON ──────────────────────────────────────────────────────────

  it('returns 400 for invalid JSON body', async () => {
    const rawBody = 'not-json'
    // A valid signature is needed to pass the early header check; parsing fails after.
    const sig = computeGitHubSignature(rawBody, WEBHOOK_SECRET)
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sig,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  // ── Missing repository info ────────────────────────────────────────────────

  it('returns 400 when payload is missing repository info', async () => {
    const body = JSON.stringify({
      action: 'opened',
      number: 42,
      pull_request: {},
    })
    const sig = computeGitHubSignature(body, WEBHOOK_SECRET)
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sig,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/repository/i)
  })

  // ── HMAC validation (early rejection + enumeration prevention) ───────────────

  it('returns 401 immediately when signature header is absent — no DB call made', async () => {
    const body = buildPayload('opened')
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        // no x-hub-signature-256
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/signature/i)
    // Must short-circuit before touching the DB
    expect(mockServiceFromFn).not.toHaveBeenCalled()
  })

  // ── Repo not configured ────────────────────────────────────────────────────

  it('returns 401 (not 404) when repo is not in configured_repos — prevents enumeration', async () => {
    const notFoundChain = makeChain({ data: null, error: { code: 'PGRST116' } })
    mockServiceFromFn.mockReturnValue(notFoundChain)

    const body = buildPayload('opened')
    const req = makeRequest(body)
    const res = await POST(req)
    // 401 instead of 404 so callers can't distinguish unknown-repo from bad-signature
    expect(res.status).toBe(401)
  })

  it('returns 401 when signature is wrong', async () => {
    const repoChain = makeConfiguredRepo(WEBHOOK_SECRET)
    mockServiceFromFn.mockReturnValue(repoChain)

    const body = buildPayload('opened')
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when webhook_secret is null (repo misconfigured)', async () => {
    const repoChain = makeConfiguredRepo(null)
    mockServiceFromFn.mockReturnValueOnce(repoChain)

    const body = buildPayload('opened')
    // Must include a signature header so the early-rejection check passes and
    // the code reaches the null-secret guard.
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/secret not configured/i)
  })

  // ── Missing action / pull_request fields ─────────────────────────────────────

  it('returns 400 when action field is absent from payload', async () => {
    const repoChain = makeConfiguredRepo()
    mockServiceFromFn.mockReturnValueOnce(repoChain)

    const rawBody = JSON.stringify({
      // no action field
      pull_request: {
        number: 42,
        title: 'x',
        html_url: `https://github.com/${OWNER}/${REPO}/pull/42`,
        state: 'open',
        user: { login: 'dev' },
        created_at: '2026-08-17T00:00:00Z',
        closed_at: null,
      },
      repository: { name: REPO, owner: { login: OWNER } },
    })
    const sig = computeGitHubSignature(rawBody, WEBHOOK_SECRET)
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sig,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/action/i)
  })

  it('returns 400 when pull_request field is absent from a well-formed payload', async () => {
    const repoChain = makeConfiguredRepo()
    mockServiceFromFn.mockReturnValueOnce(repoChain)

    const rawBody = JSON.stringify({
      action: 'opened',
      number: 42,
      // no pull_request key
      repository: { name: REPO, owner: { login: OWNER } },
    })
    const sig = computeGitHubSignature(rawBody, WEBHOOK_SECRET)
    const req = new NextRequest('http://localhost/api/webhooks/github', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': sig,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/pull_request/i)
  })

  // ── opened / reopened ────────────────────────────────────────────────────────

  it('upserts tracked_prs with status=OPEN, source=WEBHOOK on opened', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain()
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('opened')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.action).toBe('opened')

    // Check the upsert was called on tracked_prs
    expect(mockServiceFromFn).toHaveBeenCalledWith('configured_repos')
    expect(mockServiceFromFn).toHaveBeenCalledWith('tracked_prs')
    expect(prsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: OWNER,
        repo: REPO,
        pr_number: 42,
        status: 'OPEN',
        source: 'WEBHOOK',
        updated_since_review: false,
      }),
      expect.objectContaining({ onConflict: 'owner,repo,pr_number' })
    )
  })

  it('uses update (not upsert) for reopened, preserving updated_since_review and source', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain()
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('reopened')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe('reopened')
    // Must use update, not upsert
    expect(prsChain.upsert).not.toHaveBeenCalled()
    expect(prsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN' })
    )
    // updated_since_review and source must NOT be in the update payload
    const updateArg = (prsChain.update as jest.Mock).mock.calls[0][0]
    expect(updateArg).not.toHaveProperty('updated_since_review')
    expect(updateArg).not.toHaveProperty('source')
  })

  it('returns 500 when update fails on reopened', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain({ message: 'DB error' })
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('reopened')
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns 500 when upsert fails on opened', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain({ message: 'DB error' })
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('opened')
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  // ── closed ────────────────────────────────────────────────────────────────

  it('updates status=CLOSED with pr_closed_at on closed', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain()
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('closed')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe('closed')
    expect(json.matched).toBe(1)

    expect(prsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'CLOSED',
        pr_closed_at: '2026-08-17T01:00:00Z',
        updated_since_review: false,
      })
    )
    expect(prsChain.eq).toHaveBeenCalledWith('owner', OWNER)
    expect(prsChain.eq).toHaveBeenCalledWith('repo', REPO)
    expect(prsChain.eq).toHaveBeenCalledWith('pr_number', 42)
    expect(prsChain.select).toHaveBeenCalledWith('id')
  })

  it('returns 200 with matched=0 for closed event on untracked PR', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeEmptyUpdateChain()
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('closed')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.matched).toBe(0)
  })

  it('returns 500 when update fails on closed', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain({ message: 'DB error' })
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('closed')
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  // ── synchronize ───────────────────────────────────────────────────────────

  it('flips status=OPEN and sets updated_since_review=true on synchronize', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain()
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('synchronize')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe('synchronize')

    expect(prsChain.update).toHaveBeenCalledWith({
      status: 'OPEN',
      updated_since_review: true,
    })
    // Must filter by status=REVIEWED so only reviewed PRs get flipped
    expect(prsChain.eq).toHaveBeenCalledWith('status', 'REVIEWED')
  })

  it('returns 500 when update fails on synchronize', async () => {
    const repoChain = makeConfiguredRepo()
    const prsChain = makeTrackedPrsChain({ message: 'DB error' })
    mockServiceFromFn
      .mockReturnValueOnce(repoChain)
      .mockReturnValueOnce(prsChain)

    const body = buildPayload('synchronize')
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  // ── Unrecognised action ───────────────────────────────────────────────────

  it('returns 204 for unrecognised pull_request actions (e.g. labeled)', async () => {
    const repoChain = makeConfiguredRepo()
    mockServiceFromFn.mockReturnValueOnce(repoChain)

    const body = buildPayload('labeled')
    const req = makeRequest(body)
    const res = await POST(req)

    expect(res.status).toBe(204)
    // Should only hit DB once (repo lookup), not tracked_prs
    expect(mockServiceFromFn).toHaveBeenCalledTimes(1)
  })

  it('returns 204 for assigned action', async () => {
    const repoChain = makeConfiguredRepo()
    mockServiceFromFn.mockReturnValueOnce(repoChain)

    const body = buildPayload('assigned')
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(204)
  })
})
