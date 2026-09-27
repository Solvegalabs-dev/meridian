// lib/enterprise/requireEnterpriseAdmin.ts
// FF-050: Admin guard for enterprise objective management routes.
// Verifies the caller is authenticated AND holds role='admin' on the institution.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type AdminCheckOk = {
  ok: true
  userId: string
  institutionId: string
}

export type AdminCheckFail = {
  ok: false
  response: ReturnType<typeof NextResponse.json>
}

export type AdminCheckResult = AdminCheckOk | AdminCheckFail

export async function requireEnterpriseAdmin(
  institutionId: string
): Promise<AdminCheckResult> {
  // 1. Auth check
  const authClient = createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // 2. Membership + role check
  const supabase = createServiceClient()
  const { data: member } = await supabase
    .from('enterprise_members')
    .select('role')
    .eq('institution_id', institutionId)
    .eq('user_id', user.id)
    .single()

  if (!member) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not a member of this institution' },
        { status: 403 }
      ),
    }
  }

  if (member.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Admin role required' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, userId: user.id, institutionId }
}
