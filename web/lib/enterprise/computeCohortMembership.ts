/**
 * FF-041 Phase 2 — Cohort Membership Computation
 * Determines which cohort definitions a case belongs to and writes
 * rows to enterprise_case_cohort_membership.
 *
 * Called at:
 * - CSV ingest time (for all cases in a new batch)
 * - On-demand when cohort definitions are added/changed
 * - Never during a live sweep (membership is pre-computed)
 */

import { createServiceClient } from '@/lib/supabase/server'
import { buildCaseFieldMap } from './computeBuckets'

interface CohortDefinition {
  id: string
  cohort_name: string
  field_combination: Array<{ field: string; bucket_value: string }>
}

/**
 * Check if a case field map satisfies ALL conditions in a cohort definition.
 * ALL fields in field_combination must match — it's an AND condition, not OR.
 */
function caseMatchesCohort(
  fieldMap: Record<string, string>,
  cohort: CohortDefinition
): boolean {
  return cohort.field_combination.every(({ field, bucket_value }) => {
    return fieldMap[field] === bucket_value
  })
}

/**
 * Compute and write cohort membership for a list of case IDs.
 * Upserts rows to enterprise_case_cohort_membership.
 * Safe to re-run — UNIQUE (case_id, cohort_id) prevents duplicates.
 *
 * @param institutionId - The institution whose cohort definitions to use
 * @param caseIds - Array of enterprise_cases.id UUIDs to process.
 *                  Pass null to process ALL cases for the institution.
 */
export async function computeCohortMembership(
  institutionId: string,
  caseIds: string[] | null = null
): Promise<{ processed: number; memberships_written: number; errors: number }> {
  const supabase = createServiceClient()

  // Load active cohort definitions for this institution
  const { data: cohorts, error: cohortError } = await supabase
    .from('enterprise_cohort_definitions')
    .select('id, cohort_name, field_combination')
    .eq('institution_id', institutionId)
    .eq('is_active', true)

  if (cohortError || !cohorts?.length) {
    console.error('[cohort-membership] No active cohorts found:', cohortError)
    return { processed: 0, memberships_written: 0, errors: 1 }
  }

  // Load cases to process
  let query = supabase
    .from('enterprise_cases')
    .select('id, region, fico_band, income_band, employment_type, vehicle_class, vehicle_category, dti_ratio, ltv_ratio, origination_date, loan_term_months, loan_data')
    .eq('institution_id', institutionId)
    .eq('in_scope', true)

  if (caseIds?.length) {
    query = query.in('id', caseIds)
  }

  const { data: cases, error: caseError } = await query

  if (caseError || !cases?.length) {
    console.error('[cohort-membership] No cases found:', caseError)
    return { processed: 0, memberships_written: 0, errors: 1 }
  }

  let memberships_written = 0
  let errors = 0

  // Process in batches of 100 to avoid payload limits
  const BATCH_SIZE = 100
  for (let i = 0; i < cases.length; i += BATCH_SIZE) {
    const batch = cases.slice(i, i + BATCH_SIZE)
    const rows: Array<{
      institution_id: string
      case_id: string
      cohort_id: string
      computed_at: string
    }> = []

    for (const c of batch) {
      const fieldMap = buildCaseFieldMap(c)
      for (const cohort of cohorts) {
        if (caseMatchesCohort(fieldMap, cohort)) {
          rows.push({
            institution_id: institutionId,
            case_id: c.id,
            cohort_id: cohort.id,
            computed_at: new Date().toISOString(),
          })
        }
      }
    }

    if (rows.length) {
      const { error: writeError } = await supabase
        .from('enterprise_case_cohort_membership')
        .upsert(rows, { onConflict: 'case_id,cohort_id' })

      if (writeError) {
        console.error('[cohort-membership] Write error:', writeError)
        errors++
      } else {
        memberships_written += rows.length
      }
    }
  }

  return { processed: cases.length, memberships_written, errors }
}
