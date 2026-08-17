import { type NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '../../../../../src/lib/supabase/server'

/**
 * DELETE /api/queue/repos/[id]
 * Removes a configured repo.
 * Uses the service role client for consistency with other write operations
 * and to avoid any RLS edge cases on configured_repos.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const service = createSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('configured_repos')
    .delete()
    .eq('id', id)
    .select()

  if (error) {
    console.error('[DELETE /api/queue/repos/[id]]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return new NextResponse(null, { status: 204 })
}
