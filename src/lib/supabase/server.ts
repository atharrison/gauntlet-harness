import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const GH_TOKEN_COOKIE = 'gh_provider_token'

/**
 * Create a Supabase client for use in Next.js Server Components and Route Handlers.
 * Uses the anon/publishable key — RLS policies control data access per user.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // No-op in Server Components — middleware handles cookie writes.
          }
        },
      },
    }
  )
}

/**
 * Get the GitHub OAuth provider_token from the current user's session.
 * Returns null if no session or if the provider token has expired/is unavailable.
 * Falls back to GITHUB_TOKEN env var in createOctokit() if null.
 *
 * Reads from the `gh_provider_token` cookie stored during the OAuth callback.
 * We can't rely on getSession().provider_token because Supabase drops the
 * provider_token from the session on every access-token refresh — it is only
 * present in the initial exchangeCodeForSession response.
 */
export async function getGitHubToken(): Promise<string | null> {
  try {
    // Always validate the Supabase session first — if the user signed out or
    // the session expired, we should not return a token even if the cookie exists.
    const supabase = await createSupabaseServerClient()
    const { data: userData, error } = await supabase.auth.getUser()
    if (error || !userData.user) return null

    const cookieStore = await cookies()
    const token = cookieStore.get(GH_TOKEN_COOKIE)?.value
    if (token) return token

    // Fallback: session may still carry the provider_token immediately after
    // the callback (before the first token refresh).
    const { data: sessionData } = await supabase.auth.getSession()
    return sessionData.session?.provider_token ?? null
  } catch {
    return null
  }
}
