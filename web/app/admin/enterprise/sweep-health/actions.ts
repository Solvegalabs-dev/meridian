'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/admin/requireAdminUser'
import { getSweepHealth, type SweepHealthSummary } from '@/lib/enterprise/sweep-health'

export async function fetchSweepHealth(): Promise<SweepHealthSummary | { error: string }> {
  const authClient = createClient()
  const admin = await requireAdminUser(authClient)
  if (!admin) return { error: 'Unauthorized' }

  const supabase = createServiceClient()
  return getSweepHealth(supabase)
}
