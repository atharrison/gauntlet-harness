/**
 * Pure utility functions for GitHub webhook processing.
 * No I/O — safe to unit test without any mocking.
 */
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a GitHub webhook HMAC-SHA256 signature.
 *
 * @param payload  Raw request body (UTF-8 string, exactly as received)
 * @param secret   The webhook_secret stored for the repo in configured_repos
 * @param signature The X-Hub-Signature-256 header value (e.g. "sha256=abc123...")
 * @returns true if the signature is valid
 */
export function verifyGitHubSignature(
  payload: string,
  secret: string,
  signature: string | null | undefined
): boolean {
  if (!signature) return false
  const expected =
    'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  // timingSafeEqual throws if lengths differ — guard first
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Computes the X-Hub-Signature-256 header value for a payload + secret.
 * Useful in tests and tooling to generate valid signatures.
 */
export function computeGitHubSignature(
  payload: string,
  secret: string
): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex')
}
