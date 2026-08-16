import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/auth/callback
 *
 * Supabase OAuth callback handler. GitHub redirects here (via Supabase) after
 * the user authorizes the app. Exchanges the one-time code for a session and
 * redirects to the originally requested page (or / by default).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Validate `next` is a relative path to prevent open-redirect attacks.
  // `new URL(absolute, origin)` would follow the absolute URL; we only allow
  // paths that start with '/' but not '//' (protocol-relative redirect).
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            // Route Handlers can always write cookies — no try/catch needed here.
            // A failure would mean the session cookie wasn't set, causing getUser()
            // to return null and silently denying all users when an allowlist is active.
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
    }

    // Allowlist check — Phase 1 stopgap until ATH-26 ships a proper invite system.
    // Set ALLOWED_GITHUB_USERS=login1,login2 in env to restrict access.
    // Leave unset (or empty) to allow all GitHub users (local dev only).
    // Normalize to lowercase — GitHub usernames are case-insensitive and the
    // OAuth provider_token may return them in varying casing.
    const allowed = (process.env.ALLOWED_GITHUB_USERS ?? '')
      .split(',')
      .map(u => u.trim().toLowerCase())
      .filter(Boolean)

    if (allowed.length > 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      // Supabase stores the GitHub login in user_metadata.user_name for most
      // providers; fall back to identities array in case the shape differs.
      const githubLogin: string | undefined = (
        user?.user_metadata?.user_name ??
        user?.identities?.[0]?.identity_data?.user_name
      )?.toLowerCase()

      if (!githubLogin) {
        await supabase.auth.signOut()
        return NextResponse.redirect(new URL('/login?error=no_github_login', origin))
      }

      if (!allowed.includes(githubLogin)) {
        await supabase.auth.signOut()
        return NextResponse.redirect(new URL('/login?error=unauthorized', origin))
      }
    }

    return NextResponse.redirect(new URL(next, origin))
  }

  // Code missing — redirect to login with an error hint
  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
