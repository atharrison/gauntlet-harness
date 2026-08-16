import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Routes that require an authenticated Supabase session.
 * Everything else (/, /blog/*, /login, /api/auth/*) is public.
 */
const PROTECTED_PREFIXES = ['/review', '/api/review']

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

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))

  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
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
