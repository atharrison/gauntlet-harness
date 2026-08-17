import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../../src/lib/supabase/server'
import { parseRepoInput } from '../../../../src/lib/queue'

/**
 * GET /api/queue/repos
 * Returns all configured_repos, ordered by owner/name.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('configured_repos')
    .select('*')
    .order('owner', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('[GET /api/queue/repos]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  return NextResponse.json({ repos: data })
}

/**
 * POST /api/queue/repos
 * Body: { owner: string; name: string } or { repoUrl: string }
 * Adds a repo to configured_repos. Accepts either owner+name fields or a
 * full github.com URL (github.com/owner/name).
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { owner?: string; name?: string; repoUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const repoIdentifier = parseRepoInput(body)
  if (!repoIdentifier) {
    return NextResponse.json(
      { error: 'Provide owner + name, or a repoUrl (github.com/owner/name)' },
      { status: 400 }
    )
  }
  const { owner, name } = repoIdentifier

  const { data, error } = await supabase
    .from('configured_repos')
    .insert({ owner, name, active: true })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `${owner}/${name} is already configured` },
        { status: 409 }
      )
    }
    console.error('[POST /api/queue/repos]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  return NextResponse.json({ repo: data }, { status: 201 })
}
