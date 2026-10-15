// GET /api/strike/slots: how many hunting / fishing / total objective slots the signed-in Strike
// friend has used (FF-106 Stage 1). Read-only. Same session + invite gate as the other Strike
// routes. A user who is not on the strike_friend plan (no app_metadata.signup_source === 'strike')
// is not limited at all, so the form never shows a count for them.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireInvitedUser } from '@/lib/strike/ownerGuard'
import { strikeSlots } from '@/lib/strike/limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  const invited = await requireInvitedUser()
  if (invited instanceof NextResponse) return invited
  const { userId, db } = invited

  const { data: { user } } = await createClient().auth.getUser()
  if (user?.app_metadata?.signup_source !== 'strike') {
    return NextResponse.json({ unlimited: true })
  }

  const slots = await strikeSlots(db, userId)
  return NextResponse.json(slots)
}
