/**
 * Startup environment variable validation.
 *
 * Call from instrumentation.ts to fail fast with a clear, structured error
 * when required vars are missing — rather than a cryptic runtime failure deep
 * inside a route handler.
 */

const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const

export type RequiredVar = (typeof REQUIRED_VARS)[number]

/**
 * Throws if any required environment variable is absent or empty.
 * Safe to call multiple times (idempotent — no side effects on success).
 */
export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter(v => !process.env[v])
  if (missing.length === 0) {
    console.log(
      JSON.stringify({ harness_env: 'ok', vars: REQUIRED_VARS.length })
    )
    return
  }

  const list = missing.map(v => `  • ${v}`).join('\n')
  console.error(
    [
      '',
      '┌─────────────────────────────────────────────────────┐',
      '│  gauntlet-harness: missing required env variables   │',
      '└─────────────────────────────────────────────────────┘',
      '',
      'The following variables must be set before the server starts:',
      '',
      list,
      '',
      'See .env.example for documentation on each variable.',
      'In production (Railway), set these in the service Variables tab.',
      '',
    ].join('\n')
  )
  process.exit(1)
}

/** Returns the list of missing required variables without throwing. */
export function getMissingVars(): RequiredVar[] {
  return REQUIRED_VARS.filter(v => !process.env[v]) as RequiredVar[]
}
