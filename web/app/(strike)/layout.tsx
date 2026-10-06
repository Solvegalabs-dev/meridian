import type { Metadata } from 'next'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isUserInvited } from '@/lib/auth/inviteGate'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'

export const metadata: Metadata = { title: 'Meridian Strike' }
export const dynamic = 'force-dynamic'

// FF-092 Part 2.3: a signed-in user who is not on the invite list sees the invite-only screen.
// A signed-out user falls through, so each page sends them to login as before. The data pages
// repeat the check themselves, because a layout does not guard a page rendered on its own.
export default async function StrikeLayout({ children }: { children: React.ReactNode }) {
  const { data: { user } } = await createClient().auth.getUser()
  if (user && !(await isUserInvited(createServiceClient(), user))) {
    return <InviteOnlyScreen />
  }
  return <>{children}</>
}
