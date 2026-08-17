/**
 * Unit tests for the /api/queue route handlers.
 *
 * Supabase and Next.js cookie machinery are fully mocked so these run without
 * a real database.  The happy-path tests verify correct Supabase calls and
 * response shapes; error-path tests verify input validation and auth guards.
 */

import { NextRequest } from 'next/server'

// ── Supabase mock setup ────────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase query builder mock.
 * Chain methods (select, upsert, insert, update, delete, eq, order) return
 * `this` for fluent chaining.  Terminal methods (single) and direct `await`
 * on the chain both resolve to `result`.
 */
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
  // Make the chain thenable so `await client.from(...).select(...)` resolves
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

type MockChain = ReturnType<typeof makeChain>

interface MockSupabaseClient {
  auth: { getUser: jest.Mock }
  from: jest.Mock
  _chain: MockChain
}

function makeSupabaseClient(
  user: unknown,
  queryResult: { data: unknown; error: unknown }
): MockSupabaseClient {
  const chain = makeChain(queryResult)
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  }
}

const mockAnonClient: { current: MockSupabaseClient | null } = { current: null }
const mockServiceClient: { current: MockChain | null } = { current: null }

jest.mock('../src/lib/supabase/server', () => ({
  createSupabaseServerClient: jest
    .fn()
    .mockImplementation(() => mockAnonClient.current),
  createSupabaseServiceRoleClient: jest.fn().mockImplementation(() => ({
    from: jest.fn().mockReturnValue(mockServiceClient.current),
  })),
  getGitHubToken: jest.fn().mockResolvedValue(null),
  GH_TOKEN_COOKIE: 'gh_provider_token',
}))

// Ensure GITHUB_TOKEN is not set so the Octokit metadata fetch is always skipped
delete process.env.GITHUB_TOKEN

const MOCK_USER = { id: 'user-1', email: 'dev@example.com' }

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  options?: { method?: string; body?: unknown }
): NextRequest {
  return new NextRequest(url, {
    method: options?.method ?? 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
}

// ── GET /api/queue ─────────────────────────────────────────────────────────────

describe('GET /api/queue', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, { data: [], error: null })
    const { GET } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 200 with prs array on success', async () => {
    const fakePrs = [{ id: 'pr-1', owner: 'acme', repo: 'api', pr_number: 5 }]
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const serviceChain = makeChain({ data: fakePrs, error: null })
    mockServiceClient.current = serviceChain
    const { GET } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.prs).toEqual(fakePrs)
  })

  it('returns 500 when the database query fails', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const serviceChain = makeChain({
      data: null,
      error: { message: 'DB error' },
    })
    mockServiceClient.current = serviceChain
    const { GET } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue')
    const res = await GET(req)
    expect(res.status).toBe(500)
  })
})

// ── POST /api/queue ────────────────────────────────────────────────────────────

describe('POST /api/queue', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue', {
      method: 'POST',
      body: { prUrl: 'https://github.com/a/b/pull/1' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when prUrl is missing', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/prUrl/)
  })

  it('returns 400 for an invalid PR URL', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue', {
      method: 'POST',
      body: { prUrl: 'https://github.com/owner/repo' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid GitHub PR URL/)
  })

  it('returns 201 with the upserted PR row on success', async () => {
    const fakePr = {
      id: 'uuid-1',
      owner: 'acme',
      repo: 'api',
      pr_number: 42,
      pr_url: 'https://github.com/acme/api/pull/42',
      status: 'OPEN',
    }
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const serviceChain = makeChain({ data: fakePr, error: null })
    mockServiceClient.current = serviceChain
    const { POST } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue', {
      method: 'POST',
      body: { prUrl: 'https://github.com/acme/api/pull/42' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.pr).toEqual(fakePr)
  })

  it('returns 500 when upsert fails', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const serviceChain = makeChain({
      data: null,
      error: { message: 'unique constraint' },
    })
    mockServiceClient.current = serviceChain
    const { POST } = await import('../app/api/queue/route')
    const req = makeRequest('http://localhost/api/queue', {
      method: 'POST',
      body: { prUrl: 'https://github.com/acme/api/pull/1' },
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('returns 400 for invalid JSON body', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/route')
    const req = new NextRequest('http://localhost/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/queue/[id] ──────────────────────────────────────────────────────

describe('PATCH /api/queue/[id]', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { PATCH } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/pr-1', {
      method: 'PATCH',
      body: { status: 'REVIEWED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'pr-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid status value', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { PATCH } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/pr-1', {
      method: 'PATCH',
      body: { status: 'BOGUS' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'pr-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/OPEN|IN_REVIEW|REVIEWED|CLOSED/)
  })

  it('returns 200 with updated PR on success', async () => {
    const updated = { id: 'pr-1', status: 'REVIEWED' }
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({ data: updated, error: null })
    const { PATCH } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/pr-1', {
      method: 'PATCH',
      body: { status: 'REVIEWED' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'pr-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pr.status).toBe('REVIEWED')
  })

  it('returns 404 when the row does not exist (PGRST116)', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })
    const { PATCH } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/nonexistent', {
      method: 'PATCH',
      body: { status: 'REVIEWED' },
    })
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── DELETE /api/queue/[id] ────────────────────────────────────────────────────

describe('DELETE /api/queue/[id]', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { DELETE } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/pr-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'pr-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 204 on successful delete', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({
      data: [{ id: 'pr-1' }],
      error: null,
    })
    const { DELETE } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/pr-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'pr-1' }) })
    expect(res.status).toBe(204)
  })

  it('returns 404 when the row does not exist', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({ data: [], error: null })
    const { DELETE } = await import('../app/api/queue/[id]/route')
    const req = makeRequest('http://localhost/api/queue/nonexistent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── DELETE /api/queue/repos/[id] ─────────────────────────────────────────────

describe('DELETE /api/queue/repos/[id]', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { DELETE } = await import('../app/api/queue/repos/[id]/route')
    const req = makeRequest('http://localhost/api/queue/repos/r-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'r-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 204 on successful delete', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({
      data: [{ id: 'r-1' }],
      error: null,
    })
    const { DELETE } = await import('../app/api/queue/repos/[id]/route')
    const req = makeRequest('http://localhost/api/queue/repos/r-1', {
      method: 'DELETE',
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'r-1' }) })
    expect(res.status).toBe(204)
  })

  it('returns 404 when the repo does not exist', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    mockServiceClient.current = makeChain({ data: [], error: null })
    const { DELETE } = await import('../app/api/queue/repos/[id]/route')
    const req = makeRequest('http://localhost/api/queue/repos/nonexistent', {
      method: 'DELETE',
    })
    const res = await DELETE(req, {
      params: Promise.resolve({ id: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── GET /api/queue/repos ───────────────────────────────────────────────────────

describe('GET /api/queue/repos', () => {
  beforeEach(() => {
    jest.resetModules()
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { GET } = await import('../app/api/queue/repos/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 200 with repos list on success', async () => {
    const fakeRepos = [{ id: 'r-1', owner: 'acme', name: 'api' }]
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: fakeRepos,
      error: null,
    })
    const { GET } = await import('../app/api/queue/repos/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repos).toEqual(fakeRepos)
  })

  it('returns 500 on DB error', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: { message: 'DB failure' },
    })
    const { GET } = await import('../app/api/queue/repos/route')
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

// ── POST /api/queue/repos ──────────────────────────────────────────────────────

describe('POST /api/queue/repos', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    mockAnonClient.current = makeSupabaseClient(null, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: { owner: 'acme', name: 'api' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when neither owner/name nor repoUrl is provided', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('accepts owner + name fields', async () => {
    const fakeRepo = { id: 'repo-1', owner: 'acme', name: 'api' }
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: fakeRepo,
      error: null,
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: { owner: 'acme', name: 'api' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.repo).toEqual(fakeRepo)
  })

  it('accepts a github.com repoUrl', async () => {
    const fakeRepo = { id: 'repo-2', owner: 'acme', name: 'api' }
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: fakeRepo,
      error: null,
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: { repoUrl: 'https://github.com/acme/api' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('returns 409 when repo already exists', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: { code: '23505', message: 'duplicate' },
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: { owner: 'acme', name: 'api' },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already configured/)
  })

  it('returns 400 for invalid JSON body', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: null,
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = new Request('http://localhost/api/queue/repos', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'text/plain' },
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 on unexpected DB error during insert', async () => {
    mockAnonClient.current = makeSupabaseClient(MOCK_USER, {
      data: null,
      error: { code: '99999', message: 'unexpected' },
    })
    const { POST } = await import('../app/api/queue/repos/route')
    const req = makeRequest('http://localhost/api/queue/repos', {
      method: 'POST',
      body: { owner: 'acme', name: 'api' },
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
