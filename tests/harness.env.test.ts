/**
 * Tests for src/harness/env.ts
 * Validates startup env var checking — no external deps, pure process.env logic.
 */

import { validateEnv, getMissingVars } from '../src/harness/env'

// process.exit is called (not throw) so Next.js doesn't add its own error
// wrapper around the message. Mock it to prevent the test process from exiting.
let mockExit: jest.SpyInstance
let mockConsoleError: jest.SpyInstance

const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const

/** Save and restore env around each test. */
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const v of REQUIRED) savedEnv[v] = process.env[v]
  mockExit = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => {}) as () => never)
  mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const v of REQUIRED) {
    if (savedEnv[v] === undefined) delete process.env[v]
    else process.env[v] = savedEnv[v]
  }
  mockExit.mockRestore()
  mockConsoleError.mockRestore()
})

function setAllVars() {
  for (const v of REQUIRED) process.env[v] = `test-value-${v}`
}

describe('validateEnv', () => {
  it('does not throw when all required vars are set', () => {
    setAllVars()
    expect(() => validateEnv()).not.toThrow()
  })

  it('calls process.exit(1) when a single var is missing', () => {
    setAllVars()
    delete process.env['ANTHROPIC_API_KEY']
    validateEnv()
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('ANTHROPIC_API_KEY')
    )
  })

  it('lists all missing vars in the error message when multiple are absent', () => {
    setAllVars()
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['GITHUB_CLIENT_ID']
    delete process.env['GITHUB_CLIENT_SECRET']
    validateEnv()
    expect(mockExit).toHaveBeenCalledWith(1)
    const msg = mockConsoleError.mock.calls[0][0] as string
    expect(msg).toContain('ANTHROPIC_API_KEY')
    expect(msg).toContain('GITHUB_CLIENT_ID')
    expect(msg).toContain('GITHUB_CLIENT_SECRET')
  })

  it('treats an empty string as missing', () => {
    setAllVars()
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ''
    validateEnv()
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY')
    )
  })

  it('does not call process.exit when all vars are set (idempotent)', () => {
    setAllVars()
    validateEnv()
    validateEnv()
    expect(mockExit).not.toHaveBeenCalled()
  })
})

describe('getMissingVars', () => {
  it('returns empty array when all vars are set', () => {
    setAllVars()
    expect(getMissingVars()).toEqual([])
  })

  it('returns only the missing var names', () => {
    setAllVars()
    delete process.env['GITHUB_CLIENT_ID']
    delete process.env['NEXT_PUBLIC_SUPABASE_URL']
    const missing = getMissingVars()
    expect(missing).toContain('GITHUB_CLIENT_ID')
    expect(missing).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(missing).toHaveLength(2)
  })
})
