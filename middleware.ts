import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Page routes that redirect unauthenticated users to /login.
 * '/' is included so the PR URL form isn't accessible without auth.
 */
const PROTECTED_PAGES = ['/', '/review', '/queue']

/**
 * API routes that return 401 JSON for unauthenticated requests.
 * (A browser redirect is useless for fetch() callers.)
 */
const PROTECTED_API_PREFIXES = ['/api/review', '/api/queue']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Always refresh the session — keeps cookies alive and validates the token.
  // Use getUser() (not getSession()) for server-side auth checks: getUser()
  // re-validates the JWT with Supabase, while getSession() trusts the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // API routes: return 401 JSON — a redirect is useless for fetch() callers
    if (PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Page routes: redirect to login, preserving the intended destination
    const isProtectedPage =
      pathname === '/' ||
      PROTECTED_PAGES.filter(p => p !== '/').some(p => pathname.startsWith(p))
    if (isProtectedPage) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets.
     * Must run on all routes so session cookies are refreshed everywhere.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
