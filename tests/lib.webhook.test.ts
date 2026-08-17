/**
 * Unit tests for src/lib/webhook.ts — pure HMAC utility functions.
 * No mocking required: Node's crypto module is built-in.
 */
import {
  verifyGitHubSignature,
  computeGitHubSignature,
} from '../src/lib/webhook'

const SECRET = 'super-secret-key'
const PAYLOAD = JSON.stringify({ action: 'opened', number: 42 })

describe('computeGitHubSignature', () => {
  it('returns a sha256= prefixed hex string', () => {
    const sig = computeGitHubSignature(PAYLOAD, SECRET)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('produces a deterministic result for the same inputs', () => {
    expect(computeGitHubSignature(PAYLOAD, SECRET)).toBe(
      computeGitHubSignature(PAYLOAD, SECRET)
    )
  })

  it('produces different results for different payloads', () => {
    const other = JSON.stringify({ action: 'closed', number: 42 })
    expect(computeGitHubSignature(PAYLOAD, SECRET)).not.toBe(
      computeGitHubSignature(other, SECRET)
    )
  })

  it('produces different results for different secrets', () => {
    expect(computeGitHubSignature(PAYLOAD, SECRET)).not.toBe(
      computeGitHubSignature(PAYLOAD, 'different-secret')
    )
  })
})

describe('verifyGitHubSignature', () => {
  it('returns true for a valid signature', () => {
    const sig = computeGitHubSignature(PAYLOAD, SECRET)
    expect(verifyGitHubSignature(PAYLOAD, SECRET, sig)).toBe(true)
  })

  it('returns false for a tampered payload', () => {
    const sig = computeGitHubSignature(PAYLOAD, SECRET)
    const tampered = PAYLOAD + ' '
    expect(verifyGitHubSignature(tampered, SECRET, sig)).toBe(false)
  })

  it('returns false for a wrong secret', () => {
    const sig = computeGitHubSignature(PAYLOAD, 'wrong-secret')
    expect(verifyGitHubSignature(PAYLOAD, SECRET, sig)).toBe(false)
  })

  it('returns false when signature is null', () => {
    expect(verifyGitHubSignature(PAYLOAD, SECRET, null)).toBe(false)
  })

  it('returns false when signature is undefined', () => {
    expect(verifyGitHubSignature(PAYLOAD, SECRET, undefined)).toBe(false)
  })

  it('returns false when signature is an empty string', () => {
    expect(verifyGitHubSignature(PAYLOAD, SECRET, '')).toBe(false)
  })

  it('returns false when signature has wrong length', () => {
    expect(verifyGitHubSignature(PAYLOAD, SECRET, 'sha256=abc')).toBe(false)
  })

  it('returns false for a signature with the correct format but wrong value', () => {
    const sig = computeGitHubSignature(PAYLOAD, SECRET)
    // Flip the last character
    const bad = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a')
    expect(verifyGitHubSignature(PAYLOAD, SECRET, bad)).toBe(false)
  })
})
