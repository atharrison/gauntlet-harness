import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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
 */
export async function getGitHubToken(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.provider_token ?? null
  } catch {
    return null
  }
}
