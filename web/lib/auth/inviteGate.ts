// Invite list for Strike testers (FF-092 Part 2.3). Gated at the point of use, not at signup:
// the Strike pages and the session path of POST /api/objectives/create check it. Fails closed: a lookup error means not invited.
import type { createServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createServiceClient>

export const INVITE_ONLY_MESSAGE = 'Strike is invite-only. Ask the founder for an invite.'

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function isEmailInvited(db: Db, email: string): Promise<boolean> {
  const normalized = normalizeInviteEmail(email)
  if (!normalized) return false

  try {
    const { data, error } = await db
      .from('allowed_emails')
      .select('email')
      .eq('email', normalized)
      .maybeSingle()
    if (error) return false
    return data != null
  } catch {
    return false
  }
}

// A signed-in user with no email on the session cannot be on the list.
export async function isUserInvited(db: Db, user: { email?: string | null }): Promise<boolean> {
  return user.email ? isEmailInvited(db, user.email) : false
}
