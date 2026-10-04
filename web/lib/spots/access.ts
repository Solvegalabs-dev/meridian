// Ownership gate for every spot route. Same pattern as the original location route: the
// user-scoped client confirms the objective belongs to the caller; writes then use the service client.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export type OwnedObjective = { userId: string; objectiveId: string }

// Returns the owner on success, or the response to send (401 or 404).
export async function requireObjectiveOwner(objectiveId: string): Promise<OwnedObjective | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: obj } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', objectiveId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return { userId: user.id, objectiveId }
}

// Maps a thrown error to a response. Messages carry no coordinates; unexpected errors log only their message.
export function spotErrorResponse(err: unknown): NextResponse {
  if (err && typeof err === 'object' && 'status' in err && 'body' in err) {
    const e = err as { message: string; status: number; body: Record<string, unknown> }
    return NextResponse.json({ error: e.message, ...e.body }, { status: e.status })
  }
  console.error('[spots] unexpected error:', err instanceof Error ? err.message : 'unknown')
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}

export async function readJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
}
