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
  const next = searchParams.get('next') ?? '/'

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
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // No-op when called from a Server Component — cookies are set
              // by the middleware on the response instead.
            }
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  // Code missing or exchange failed — redirect to login with an error hint
  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
