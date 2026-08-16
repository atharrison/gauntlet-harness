import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  GH_TOKEN_COOKIE,
} from '../../../../src/lib/supabase/server'

/**
 * POST /api/auth/signout
 *
 * Clears the Supabase session and the separately-stored GitHub provider token
 * cookie. The gh_provider_token is httpOnly so it can't be deleted from
 * client-side JS — sign-out must go through this server route.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut().catch(() => null)

  const cookieStore = await cookies()
  cookieStore.delete(GH_TOKEN_COOKIE)

  // 303 See Other ensures the browser issues a GET to /login rather than
  // re-POSTing (which is the default browser behavior for 307/308 on POST).
  return NextResponse.redirect(new URL('/login', _request.url), { status: 303 })
}
