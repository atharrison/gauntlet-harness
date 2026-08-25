import { parsePrUrl } from '../src/lib/queue'
import {
  TrackedPrStatus,
  buildInReviewUpsert,
  buildReviewedPatch,
} from '../src/lib/tracked-prs'

const parsed = parsePrUrl('https://github.com/acme/app/pull/42')!

describe('TrackedPrStatus', () => {
  it('uses UPPER_CASE string values', () => {
    expect(TrackedPrStatus.OPEN).toBe('OPEN')
    expect(TrackedPrStatus.IN_REVIEW).toBe('IN_REVIEW')
    expect(TrackedPrStatus.REVIEWED).toBe('REVIEWED')
    expect(TrackedPrStatus.CLOSED).toBe('CLOSED')
  })
})

describe('buildInReviewUpsert', () => {
  it('sets IN_REVIEW and last_review_id from the parsed URL', () => {
    expect(buildInReviewUpsert(parsed, 'rev-1')).toEqual({
      owner: 'acme',
      repo: 'app',
      pr_number: 42,
      pr_url: 'https://github.com/acme/app/pull/42',
      status: TrackedPrStatus.IN_REVIEW,
      last_review_id: 'rev-1',
    })
  })

  it('does not include review_count (owned by the DB trigger)', () => {
    expect(buildInReviewUpsert(parsed, 'rev-1')).not.toHaveProperty(
      'review_count'
    )
  })

  it('omits last_review_id when the reviews row was not created', () => {
    expect(buildInReviewUpsert(parsed, null)).not.toHaveProperty(
      'last_review_id'
    )
    expect(buildInReviewUpsert(parsed, null).status).toBe(
      TrackedPrStatus.IN_REVIEW
    )
  })

  it('always sets IN_REVIEW with no prior-status field (CLOSED is overwritten)', () => {
    const row = buildInReviewUpsert(parsed, 'rev-1')
    expect(row.status).toBe(TrackedPrStatus.IN_REVIEW)
    expect(Object.keys(row)).not.toContain('prior_status')
  })
})

describe('buildReviewedPatch', () => {
  it('sets REVIEWED and last_review_id without touching review_count', () => {
    const patch = buildReviewedPatch('rev-9')
    expect(patch).toEqual({
      status: TrackedPrStatus.REVIEWED,
      last_review_id: 'rev-9',
    })
    expect(patch).not.toHaveProperty('review_count')
  })
})
