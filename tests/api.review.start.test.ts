/**
 * Tests for POST /api/review/start — ATH-15 tracked_prs lifecycle.
 */

import { NextRequest } from 'next/server'

const mockCreateReview = jest.fn().mockResolvedValue(undefined)
const mockMarkPrInReview = jest.fn().mockResolvedValue(undefined)

jest.mock('../src/memory/review-store', () => ({
  createReview: (...args: unknown[]) => mockCreateReview(...args),
}))

jest.mock('../src/memory/tracked-pr-store', () => ({
  markPrInReview: (...args: unknown[]) => mockMarkPrInReview(...args),
}))

const PR_URL = 'https://github.com/acme/app/pull/42'

async function postStart(body: unknown) {
  const { POST } = await import('../app/api/review/start/route')
  const req = new NextRequest('http://localhost/api/review/start', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return POST(req)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateReview.mockResolvedValue(undefined)
  mockMarkPrInReview.mockResolvedValue(undefined)
  delete process.env.ACCESS_PASSWORDS
})

describe('POST /api/review/start — validation', () => {
  it('returns 400 for invalid JSON', async () => {
    const res = await postStart('not-json')
    expect(res.status).toBe(400)
  })

  it('returns 422 for a missing prUrl', async () => {
    const res = await postStart({})
    expect(res.status).toBe(422)
  })

  it('returns 401 when ACCESS_PASSWORDS is set and the password is wrong', async () => {
    process.env.ACCESS_PASSWORDS = 'secret'
    const res = await postStart({ prUrl: PR_URL, password: 'nope' })
    expect(res.status).toBe(401)
    expect(mockCreateReview).not.toHaveBeenCalled()
    expect(mockMarkPrInReview).not.toHaveBeenCalled()
  })
})

describe('POST /api/review/start — tracked_prs lifecycle', () => {
  it('returns 202 and upserts the PR as IN_REVIEW with last_review_id', async () => {
    const res = await postStart({ prUrl: PR_URL, mode: 'quick' })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.prUrl).toBe(PR_URL)
    expect(body.mode).toBe('quick')
    expect(body.reviewId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(mockCreateReview).toHaveBeenCalledWith(
      body.reviewId,
      PR_URL,
      'quick'
    )
    expect(mockMarkPrInReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'app',
        pr_number: 42,
      }),
      body.reviewId
    )
  })

  it('still returns 202 when the PR is not already in the queue (upsert, not OPEN-only update)', async () => {
    const res = await postStart({ prUrl: PR_URL })
    expect(res.status).toBe(202)
    expect(mockMarkPrInReview).toHaveBeenCalledTimes(1)
  })

  it('still returns 202 when markPrInReview fails (best-effort)', async () => {
    mockMarkPrInReview.mockRejectedValue(new Error('db down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await postStart({ prUrl: PR_URL })
    expect(res.status).toBe(202)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('still returns 202 when createReview fails, and still marks IN_REVIEW', async () => {
    mockCreateReview.mockRejectedValue(new Error('insert failed'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await postStart({ prUrl: PR_URL })
    expect(res.status).toBe(202)
    expect(mockMarkPrInReview).toHaveBeenCalled()
    expect(mockMarkPrInReview.mock.calls[0][1]).toBeNull()
    spy.mockRestore()
  })

  it('skips tracked_prs when prUrl is a URL but not a GitHub PR', async () => {
    const res = await postStart({ prUrl: 'https://example.com/not-a-pr' })
    expect(res.status).toBe(202)
    expect(mockMarkPrInReview).not.toHaveBeenCalled()
  })
})

describe('GET /api/review/start — form fallback', () => {
  async function getStart(search: string) {
    const { GET } = await import('../app/api/review/start/route')
    const req = new NextRequest(`http://localhost/api/review/start${search}`)
    return GET(req)
  }

  it('redirects home when prUrl is missing', async () => {
    const res = await getStart('')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/error=missing_pr_url/)
    expect(mockMarkPrInReview).not.toHaveBeenCalled()
  })

  it('redirects home when prUrl is not a GitHub PR URL', async () => {
    const res = await getStart('?prUrl=https://example.com/not-a-pr')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/error=invalid_pr_url/)
    expect(mockMarkPrInReview).not.toHaveBeenCalled()
  })

  it('creates the review, marks IN_REVIEW, and redirects to the review page', async () => {
    const res = await getStart(`?prUrl=${encodeURIComponent(PR_URL)}`)
    expect(res.status).toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toMatch(/\/review\/[0-9a-f-]{36}\?prUrl=/)
    expect(mockCreateReview).toHaveBeenCalled()
    expect(mockMarkPrInReview).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'app', pr_number: 42 }),
      expect.any(String)
    )
  })
})
