import { type NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from '../../../../src/lib/supabase/server'

const VALID_STATUSES = ['OPEN', 'IN_REVIEW', 'REVIEWED', 'CLOSED'] as const
type TrackedPrStatus = (typeof VALID_STATUSES)[number]

/**
 * PATCH /api/queue/[id]
 * Body: { status: TrackedPrStatus }
 * Updates the status of a tracked PR.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status } = body
  if (!status || !VALID_STATUSES.includes(status as TrackedPrStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  const service = createSupabaseServiceRoleClient()
  const { data, error } = await service
    .from('tracked_prs')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('[PATCH /api/queue/[id]]', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
  return NextResponse.json({ pr: data })
}

/**
 * DELETE /api/queue/[id]
 * Removes a tracked PR from the queue.
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
    .from('tracked_prs')
    .delete()
    .eq('id', id)
    .select()

  if (error) {
    console.error('[DELETE /api/queue/[id]]', error)
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
