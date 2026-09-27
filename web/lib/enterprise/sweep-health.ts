import type { SupabaseClient } from '@supabase/supabase-js'

export type SweepHealthRow = {
  id: string
  institution_id: string
  institution_name: string
  objective_id: string | null
  sweep_type: string
  fork: string | null
  status: string
  error_message: string | null
  created_at: string
}

export type SweepHealthSummary = {
  windowHours: number
  totals: { attempted: number; succeeded: number; failed: number }
  bySweepType: Record<string, { attempted: number; succeeded: number; failed: number }>
  failures: SweepHealthRow[]
  fetchedAt: string
}

// Reuses the existing enterprise_sweeps.error_message column rather than
// adding a new sweep_error column — error_message already exists for
// exactly this purpose, it was just never populated by any caller (see
// FF-035D-adjacent fix in app/api/enterprise/sweep/route.ts and
// lite-sweep-cron/route.ts, which now write a status='failed' row with
// error_message set whenever a Promise.allSettled objective sweep rejects).
export async function getSweepHealth(
  supabase: SupabaseClient,
  windowHours = 72
): Promise<SweepHealthSummary> {
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString()

  const [{ data: sweeps }, { data: institutions }] = await Promise.all([
    supabase
      .from('enterprise_sweeps')
      .select('id, institution_id, objective_id, sweep_type, fork, status, error_message, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('enterprise_institutions').select('id, name'),
  ])

  const nameById = new Map((institutions ?? []).map(i => [i.id as string, i.name as string]))
  const rows: SweepHealthRow[] = (sweeps ?? []).map(s => ({
    id: s.id as string,
    institution_id: s.institution_id as string,
    institution_name: nameById.get(s.institution_id as string) ?? (s.institution_id as string),
    objective_id: s.objective_id as string | null,
    sweep_type: (s.sweep_type as string) ?? 'unknown',
    fork: s.fork as string | null,
    status: s.status as string,
    error_message: s.error_message as string | null,
    created_at: s.created_at as string,
  }))

  const totals = { attempted: rows.length, succeeded: 0, failed: 0 }
  const bySweepType: SweepHealthSummary['bySweepType'] = {}

  for (const row of rows) {
    const bucket = bySweepType[row.sweep_type] ?? (bySweepType[row.sweep_type] = { attempted: 0, succeeded: 0, failed: 0 })
    bucket.attempted++
    if (row.status === 'failed') {
      totals.failed++
      bucket.failed++
    } else if (row.status === 'complete') {
      totals.succeeded++
      bucket.succeeded++
    }
  }

  return {
    windowHours,
    totals,
    bySweepType,
    failures: rows.filter(r => r.status === 'failed'),
    fetchedAt: new Date().toISOString(),
  }
}
