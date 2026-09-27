import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/admin/requireAdminUser'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = await requireAdminUser(supabase)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as Record<string, unknown>
  const service = createServiceClient()

  // Explicit allowlist from cohort_report_configs schema — never spread raw body
  const safeInsert = {
    org_name:                    typeof body.org_name === 'string'                    ? body.org_name                    : undefined,
    org_code:                    typeof body.org_code === 'string'                    ? body.org_code                    : undefined,
    section_cohort_overview:     typeof body.section_cohort_overview === 'boolean'    ? body.section_cohort_overview     : undefined,
    section_objective_tracking:  typeof body.section_objective_tracking === 'boolean' ? body.section_objective_tracking  : undefined,
    section_confidence_trends:   typeof body.section_confidence_trends === 'boolean'  ? body.section_confidence_trends   : undefined,
    section_sweep_activity:      typeof body.section_sweep_activity === 'boolean'     ? body.section_sweep_activity      : undefined,
    section_cross_dep_flags:     typeof body.section_cross_dep_flags === 'boolean'    ? body.section_cross_dep_flags     : undefined,
    section_engagement_summary:  typeof body.section_engagement_summary === 'boolean' ? body.section_engagement_summary  : undefined,
    section_predictions_active:  typeof body.section_predictions_active === 'boolean' ? body.section_predictions_active  : undefined,
    section_top_signals:         typeof body.section_top_signals === 'boolean'        ? body.section_top_signals         : undefined,
    delivery_email:              typeof body.delivery_email === 'boolean'             ? body.delivery_email              : undefined,
    delivery_drive:              typeof body.delivery_drive === 'boolean'             ? body.delivery_drive              : undefined,
    recipient_emails:            Array.isArray(body.recipient_emails)                 ? body.recipient_emails            : undefined,
    drive_folder_id:             typeof body.drive_folder_id === 'string'             ? body.drive_folder_id             : undefined,
    drive_folder_name:           typeof body.drive_folder_name === 'string'           ? body.drive_folder_name           : undefined,
    send_frequency:              typeof body.send_frequency === 'string'              ? body.send_frequency              : undefined,
    send_day:                    typeof body.send_day === 'string'                    ? body.send_day                    : undefined,
    last_sent_at:                typeof body.last_sent_at === 'string'                ? body.last_sent_at                : undefined,
    updated_at: new Date().toISOString(),
  }

  const cleanInsert = Object.fromEntries(
    Object.entries(safeInsert).filter(([, v]) => v !== undefined)
  )

  const { data: config, error } = await service
    .from('cohort_report_configs')
    .insert(cleanInsert)
    .select()
    .single()

  if (error) {
    console.error('[cohorts POST]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ config })
}
