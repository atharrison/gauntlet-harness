import { parsePrUrl, parseRepoInput } from '../src/lib/queue'

// ── parsePrUrl ─────────────────────────────────────────────────────────────────

describe('parsePrUrl', () => {
  it('parses a standard PR URL', () => {
    const result = parsePrUrl('https://github.com/owner/my-repo/pull/42')
    expect(result).toEqual({
      owner: 'owner',
      repo: 'my-repo',
      pr_number: 42,
      canonical_url: 'https://github.com/owner/my-repo/pull/42',
    })
  })

  it('strips query string from canonical_url', () => {
    const result = parsePrUrl(
      'https://github.com/owner/repo/pull/1?diff=split&w=1'
    )
    expect(result?.canonical_url).toBe('https://github.com/owner/repo/pull/1')
    expect(result?.pr_number).toBe(1)
  })

  it('strips hash fragment from canonical_url', () => {
    const result = parsePrUrl(
      'https://github.com/owner/repo/pull/7#issuecomment-99'
    )
    expect(result?.canonical_url).toBe('https://github.com/owner/repo/pull/7')
  })

  it('handles http:// scheme', () => {
    const result = parsePrUrl('http://github.com/owner/repo/pull/3')
    expect(result).not.toBeNull()
    expect(result?.pr_number).toBe(3)
  })

  it('handles repo names with dots and underscores', () => {
    const result = parsePrUrl('https://github.com/my-org/my.repo_name/pull/99')
    expect(result?.repo).toBe('my.repo_name')
    expect(result?.pr_number).toBe(99)
  })

  it('returns null for a repo URL (no /pull/)', () => {
    expect(parsePrUrl('https://github.com/owner/repo')).toBeNull()
  })

  it('returns null for a commit URL', () => {
    expect(parsePrUrl('https://github.com/owner/repo/commit/abc123')).toBeNull()
  })

  it('returns null for a non-GitHub URL', () => {
    expect(
      parsePrUrl('https://gitlab.com/owner/repo/merge_requests/1')
    ).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parsePrUrl('')).toBeNull()
  })

  it('returns null when PR number is missing', () => {
    expect(parsePrUrl('https://github.com/owner/repo/pull/')).toBeNull()
  })
})

// ── parseRepoInput ─────────────────────────────────────────────────────────────

describe('parseRepoInput', () => {
  it('returns owner+name from explicit fields', () => {
    expect(parseRepoInput({ owner: 'acme', name: 'api' })).toEqual({
      owner: 'acme',
      name: 'api',
    })
  })

  it('trims whitespace from explicit fields', () => {
    expect(parseRepoInput({ owner: '  acme  ', name: '  api  ' })).toEqual({
      owner: 'acme',
      name: 'api',
    })
  })

  it('parses a full github.com URL', () => {
    expect(parseRepoInput({ repoUrl: 'https://github.com/acme/api' })).toEqual({
      owner: 'acme',
      name: 'api',
    })
  })

  it('strips .git suffix from repoUrl', () => {
    expect(
      parseRepoInput({ repoUrl: 'https://github.com/acme/api.git' })
    ).toEqual({ owner: 'acme', name: 'api' })
  })

  it('ignores trailing path after repo name in repoUrl', () => {
    expect(
      parseRepoInput({ repoUrl: 'https://github.com/acme/api/tree/main' })
    ).toEqual({ owner: 'acme', name: 'api' })
  })

  it('returns null when only owner is provided', () => {
    expect(parseRepoInput({ owner: 'acme' })).toBeNull()
  })

  it('returns null when only name is provided', () => {
    expect(parseRepoInput({ name: 'api' })).toBeNull()
  })

  it('returns null when repoUrl is not a github.com URL', () => {
    expect(
      parseRepoInput({ repoUrl: 'https://gitlab.com/acme/api' })
    ).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseRepoInput({})).toBeNull()
  })

  it('falls back to repoUrl when owner/name fields are empty strings', () => {
    expect(
      parseRepoInput({
        owner: '',
        name: '',
        repoUrl: 'https://github.com/acme/api',
      })
    ).toEqual({ owner: 'acme', name: 'api' })
  })
})
