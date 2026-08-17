import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { GH_TOKEN_COOKIE } from '../../../../src/lib/supabase/server'

/**
 * GET /api/auth/callback
 *
 * Supabase OAuth callback handler. GitHub redirects here (via Supabase) after
 * the user authorizes the app. Exchanges the one-time code for a session and
 * redirects to the originally requested page (or / by default).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  // Railway (and other reverse-proxy hosts) bind the app to an internal address
  // (e.g. 0.0.0.0:8080) and forward the real public hostname via headers.
  // Prefer NEXT_PUBLIC_SITE_URL when set, then x-forwarded-* headers, then
  // fall back to the request origin (works fine for local dev).
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
    (forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : new URL(request.url).origin)
  const code = searchParams.get('code')
  // Validate `next` is a relative path to prevent open-redirect attacks.
  // `new URL(absolute, origin)` would follow the absolute URL; we only allow
  // paths that start with '/' but not '//' (protocol-relative redirect).
  // Default to /queue — the PR review queue is the primary landing page post-login.
  const rawNext = searchParams.get('next') ?? '/queue'
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

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

    const { data: exchangeData, error } =
      await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
    }

    // Supabase drops provider_token from the session on every token refresh
    // (the refresh endpoint doesn't return it). Store it in a separate httpOnly
    // cookie so getGitHubToken() can read it on subsequent requests.
    const providerToken = exchangeData.session?.provider_token
    if (providerToken) {
      cookieStore.set(GH_TOKEN_COOKIE, providerToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 8, // 8 hours — matches typical GitHub OAuth token lifetime
        path: '/',
      })
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
      // Use the user from the exchange result directly — no extra network call needed.
      const user = exchangeData.session?.user
      // Supabase stores the GitHub login in user_metadata.user_name for most
      // providers; fall back to identities array in case the shape differs.
      const githubLogin: string | undefined = (
        user?.user_metadata?.user_name ??
        user?.identities?.[0]?.identity_data?.user_name
      )?.toLowerCase()

      // Helper: sign out and clear the provider token cookie before denying access.
      // Best-effort sign-out — if it fails, middleware blocks on the next request.
      const denyAndRedirect = async (error: string) => {
        await supabase.auth.signOut().catch(() => null)
        cookieStore.delete(GH_TOKEN_COOKIE)
        return NextResponse.redirect(new URL(`/login?error=${error}`, origin))
      }

      if (!githubLogin) return await denyAndRedirect('no_github_login')
      if (!allowed.includes(githubLogin))
        return await denyAndRedirect('unauthorized')
    }

    return NextResponse.redirect(new URL(next, origin))
  }

  // Code missing — redirect to login with an error hint
  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
