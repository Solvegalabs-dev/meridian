import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const SUPABASE_PROJECT = 'naskidrydhxbxnpplvla'

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { institution_id, objective_id, trigger_type = 'manual' } = body
  if (!institution_id || !objective_id) {
    return NextResponse.json({ error: 'institution_id and objective_id required' }, { status: 400 })
  }

  // Proxy to enterprise-sweep Edge Function — DPA gate is enforced inside the function
  let res: Response
  try {
    res = await fetch(
      `https://${SUPABASE_PROJECT}.supabase.co/functions/v1/enterprise-sweep`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution_id, objective_id, trigger_type }),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Edge Function unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = { error: 'Edge Function returned non-JSON response' }
  }
  return NextResponse.json(data, { status: res.status })
}
