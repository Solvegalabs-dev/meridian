// Invite list for Strike testers (FF-092 Part 2.3). Fails closed: a lookup error means not invited.
// The check is not yet wired into any signup or login flow. See the FF-092 PR for the open question.
import type { createServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createServiceClient>

export const INVITE_ONLY_MESSAGE = 'Strike is invite-only. Ask the founder for an invite.'

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function isEmailInvited(db: Db, email: string): Promise<boolean> {
  const normalized = normalizeInviteEmail(email)
  if (!normalized) return false

  const { data, error } = await db
    .from('allowed_emails')
    .select('email')
    .eq('email', normalized)
    .maybeSingle()
  if (error) return false

  return data != null
}
