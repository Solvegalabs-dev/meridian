/**
 * FF-041 Phase 3 — Adaptive Learning Layer
 *
 * Reads sweep output to discover:
 * A) New cohort candidates — field combinations that recur across sweeps
 * B) Uncaptured field concepts — data dimensions referenced in signals
 *    but not present as case fields or macro events
 *
 * Runs after each enterprise sweep completes. Writes candidates to
 * enterprise_cohort_candidates and enterprise_field_candidates for
 * admin review. Does NOT auto-approve or auto-modify anything.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { buildCaseFieldMap } from './computeBuckets'

// ─── THRESHOLDS ──────────────────────────────────────────────────────────────
const COHORT_MIN_FREQUENCY = 5
const COHORT_MIN_CONFIDENCE_CLUSTER = 3
const COHORT_CONFIDENCE_CONVERGENCE_BAND = 5  // ±5 points = converging

const FIELD_MIN_OCCURRENCES = 3

// Tier II bucket fields — these are already captured, skip as "uncaptured"
const KNOWN_BUCKET_FIELDS = new Set([
  'region', 'fico_band', 'income_band', 'employment_type',
  'vehicle_class', 'vehicle_model_class', 'vehicle_category',
  'vehicle_condition', 'gap_insurance_flag', 'residence_type',
  'dti_bucket', 'ltv_bucket', 'vintage_bucket', 'term_bucket',
  'make_group', 'payment_streak_bucket', 'times_30_dpd_bucket',
])

// Field concepts to watch for in sweep signal text.
// Do NOT add patterns without Jason approval — each has schema/pricing implications.
const FIELD_CONCEPT_PATTERNS: Array<{
  concept: string
  patterns: RegExp[]
  is_in_macro_events: boolean
  schema_change_required: boolean
}> = [
  {
    concept: 'savings_rate',
    patterns: [/savings rate/i, /savings account/i, /deposit balance/i, /emergency fund/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
  {
    concept: 'debt_service_ratio',
    patterns: [/debt service/i, /debt.service ratio/i, /total debt obligation/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
  {
    concept: 'local_unemployment_by_industry',
    patterns: [/local unemployment/i, /sector unemployment/i, /industry.*layoff/i, /regional.*job loss/i],
    is_in_macro_events: true,
    schema_change_required: false,
  },
  {
    concept: 'flood_zone',
    patterns: [/flood zone/i, /fema flood/i, /100.year flood/i, /special flood/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
  {
    concept: 'vehicle_recall_status',
    patterns: [/recall/i, /nhtsa/i, /vehicle recall/i, /safety recall/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
  {
    concept: 'insurance_claim_history',
    patterns: [/insurance claim/i, /prior claim/i, /total loss history/i, /clue report/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
  {
    concept: 'regional_fuel_price',
    patterns: [/fuel price/i, /gas price/i, /gasoline cost/i, /diesel price/i],
    is_in_macro_events: true,
    schema_change_required: false,
  },
  {
    concept: 'commute_distance',
    patterns: [/commute/i, /distance to work/i, /miles to employer/i],
    is_in_macro_events: false,
    schema_change_required: true,
  },
]

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface CohortPattern {
  field_combination: Record<string, string>
  case_ids: string[]
  confidence_deltas: number[]
  first_seen: string
  last_seen: string
  sweep_count: number
}

// ─── COMPONENT A: COHORT DISCOVERY ──────────────────────────────────────────

/**
 * Analyze recent sweep history for an institution to find recurring
 * field combinations that might warrant a new cohort definition.
 */
export async function discoverCohortCandidates(
  institutionId: string,
  lookbackDays = 30
): Promise<{ candidates_found: number; candidates_written: number }> {
  const supabase = createServiceClient()
  const lookbackDate = new Date(Date.now() - lookbackDays * 86400000).toISOString()

  // Load recent sweep-type snapshots with their case field data
  const { data: recentHistory } = await supabase
    .from('enterprise_case_history')
    .select(`
      id, case_id, drift_score, confidence_pct, snapshot_at,
      enterprise_cases!inner(
        id, region, fico_band, income_band, employment_type,
        vehicle_class, vehicle_category, dti_ratio, ltv_ratio,
        origination_date, loan_term_months, loan_data
      )
    `)
    .eq('institution_id', institutionId)
    .eq('snapshot_type', 'sweep')
    .gte('snapshot_at', lookbackDate)
    .order('snapshot_at', { ascending: false })
    .limit(1000)

  if (!recentHistory?.length) {
    return { candidates_found: 0, candidates_written: 0 }
  }

  // Get existing cohort definitions to avoid re-suggesting known cohorts
  const { data: existingCohorts } = await supabase
    .from('enterprise_cohort_definitions')
    .select('field_combination')
    .eq('institution_id', institutionId)
    .eq('is_active', true)

  const existingCombos = new Set(
    (existingCohorts ?? []).map(c =>
      JSON.stringify(
        (c.field_combination as Array<{ field: string; bucket_value: string }>)
          .sort((a, b) => a.field.localeCompare(b.field))
      )
    )
  )

  const patternMap = new Map<string, CohortPattern>()

  for (const snapshot of recentHistory) {
    const caseData = snapshot.enterprise_cases as unknown as {
      id: string
      region?: string | null
      fico_band?: string | null
      income_band?: string | null
      employment_type?: string | null
      vehicle_class?: string | null
      vehicle_category?: string | null
      dti_ratio?: number | null
      ltv_ratio?: number | null
      origination_date?: string | null
      loan_term_months?: number | null
      loan_data?: Record<string, unknown> | null
    }

    const fieldMap = buildCaseFieldMap({
      region: caseData.region,
      fico_band: caseData.fico_band,
      income_band: caseData.income_band,
      employment_type: caseData.employment_type,
      vehicle_class: caseData.vehicle_class,
      vehicle_category: caseData.vehicle_category,
      dti_ratio: caseData.dti_ratio,
      ltv_ratio: caseData.ltv_ratio,
      origination_date: caseData.origination_date,
      loan_term_months: caseData.loan_term_months,
      loan_data: caseData.loan_data,
    })

    const fields = Object.entries(fieldMap)
    const combinations = generateFieldCombinations(fields, 2, 3)

    for (const combo of combinations) {
      const sorted = combo.sort((a, b) => a[0].localeCompare(b[0]))
      const comboKey = JSON.stringify(sorted)

      const cohortStyle = JSON.stringify(
        sorted.map(([field, bucket_value]) => ({ field, bucket_value }))
      )
      if (existingCombos.has(cohortStyle)) continue

      if (!patternMap.has(comboKey)) {
        patternMap.set(comboKey, {
          field_combination: Object.fromEntries(sorted),
          case_ids: [],
          confidence_deltas: [],
          first_seen: snapshot.snapshot_at,
          last_seen: snapshot.snapshot_at,
          sweep_count: 0,
        })
      }

      const pattern = patternMap.get(comboKey)!
      if (!pattern.case_ids.includes(snapshot.case_id)) {
        pattern.case_ids.push(snapshot.case_id)
      }
      if (snapshot.confidence_pct != null) {
        pattern.confidence_deltas.push(snapshot.confidence_pct)
      }
      if (snapshot.snapshot_at < pattern.first_seen) pattern.first_seen = snapshot.snapshot_at
      if (snapshot.snapshot_at > pattern.last_seen) pattern.last_seen = snapshot.snapshot_at
      pattern.sweep_count++
    }
  }

  // Evaluate patterns against discovery thresholds
  const candidatesToWrite: Array<{
    institution_id: string
    proposed_name: string
    field_combination: Array<{ field: string; bucket_value: string }>
    trigger_count: number
    confidence_delta_avg: number
    confidence_delta_std: number
    first_seen_at: string
    last_seen_at: string
    status: string
  }> = []

  for (const [, pattern] of Array.from(patternMap.entries())) {
    const meetsFrequency = pattern.case_ids.length >= COHORT_MIN_FREQUENCY

    if (!meetsFrequency || pattern.confidence_deltas.length < COHORT_MIN_CONFIDENCE_CLUSTER) continue

    const avg = pattern.confidence_deltas.reduce((s, v) => s + v, 0) / pattern.confidence_deltas.length
    const std = Math.sqrt(
      pattern.confidence_deltas.reduce((s, v) => s + Math.pow(v - avg, 2), 0) /
      pattern.confidence_deltas.length
    )

    if (std > COHORT_CONFIDENCE_CONVERGENCE_BAND) continue

    const fieldCombo = Object.entries(pattern.field_combination)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, bucket_value]) => ({ field, bucket_value }))

    const proposedName = fieldCombo
      .map(({ field, bucket_value }) => `${field}=${bucket_value}`)
      .join(' + ')

    candidatesToWrite.push({
      institution_id: institutionId,
      proposed_name: proposedName,
      field_combination: fieldCombo,
      trigger_count: pattern.case_ids.length,
      confidence_delta_avg: parseFloat(avg.toFixed(2)),
      confidence_delta_std: parseFloat(std.toFixed(2)),
      first_seen_at: pattern.first_seen,
      last_seen_at: pattern.last_seen,
      status: 'pending',
    })
  }

  if (!candidatesToWrite.length) {
    return { candidates_found: patternMap.size, candidates_written: 0 }
  }

  let written = 0
  for (const candidate of candidatesToWrite) {
    const { data: existing } = await supabase
      .from('enterprise_cohort_candidates')
      .select('id, trigger_count')
      .eq('institution_id', institutionId)
      .eq('proposed_name', candidate.proposed_name)
      .eq('status', 'pending')
      .single()

    if (existing) {
      await supabase
        .from('enterprise_cohort_candidates')
        .update({
          trigger_count: existing.trigger_count + candidate.trigger_count,
          last_seen_at: candidate.last_seen_at,
          confidence_delta_avg: candidate.confidence_delta_avg,
          confidence_delta_std: candidate.confidence_delta_std,
        })
        .eq('id', existing.id)
    } else {
      const { error } = await supabase
        .from('enterprise_cohort_candidates')
        .insert(candidate)
      if (!error) written++
    }
  }

  return { candidates_found: patternMap.size, candidates_written: written }
}

/**
 * Generate 2- and 3-field combinations from a case's field map.
 * Only uses Tier II bucket fields that are meaningful for cohort definition.
 */
function generateFieldCombinations(
  fields: [string, string][],
  minSize: number,
  maxSize: number
): [string, string][][] {
  const result: [string, string][][] = []
  const bucketFields = fields.filter(([field]) => KNOWN_BUCKET_FIELDS.has(field))

  function combine(start: number, current: [string, string][]) {
    if (current.length >= minSize) result.push([...current])
    if (current.length === maxSize) return
    for (let i = start; i < bucketFields.length; i++) {
      current.push(bucketFields[i])
      combine(i + 1, current)
      current.pop()
    }
  }

  combine(0, [])
  return result
}

// ─── COMPONENT B: FIELD DISCOVERY ───────────────────────────────────────────

/**
 * Scan recent sweep output text for uncaptured field concepts.
 * Reads enterprise_objective_results text columns and enterprise_sweep_signals
 * signal_body to find references to data dimensions not yet in the schema.
 */
export async function discoverFieldCandidates(
  institutionId: string,
  lookbackDays = 30
): Promise<{ concepts_found: number; candidates_written: number }> {
  const supabase = createServiceClient()
  const lookbackDate = new Date(Date.now() - lookbackDays * 86400000).toISOString()

  // Load recent objective results — rich text output from FF-035 Two-Fork
  const { data: recentResults } = await supabase
    .from('enterprise_objective_results')
    .select('id, signals, implies, affecting_it, what_to_do, computed_at')
    .eq('institution_id', institutionId)
    .gte('computed_at', lookbackDate)
    .order('computed_at', { ascending: false })
    .limit(500)

  if (!recentResults?.length) {
    return { concepts_found: 0, candidates_written: 0 }
  }

  // Also scan enterprise_sweep_signals signal_body
  const { data: signalCache } = await supabase
    .from('enterprise_sweep_signals')
    .select('signal_type, signal_body')
    .eq('institution_id', institutionId)
    .gte('created_at', lookbackDate)
    .limit(500)

  // Build corpus of all sweep text to scan
  const textCorpus: string[] = []

  for (const result of recentResults) {
    if (result.signals) textCorpus.push(result.signals)
    if (result.implies) textCorpus.push(result.implies)
    if (result.affecting_it) textCorpus.push(result.affecting_it)
    if (result.what_to_do) textCorpus.push(result.what_to_do)
  }

  for (const signal of signalCache ?? []) {
    if (signal.signal_body) textCorpus.push(signal.signal_body)
  }

  // Count occurrences of each field concept pattern across the corpus
  const conceptCounts = new Map<string, {
    count: number
    examples: string[]
    is_in_macro_events: boolean
    schema_change_required: boolean
  }>()

  for (const text of textCorpus) {
    for (const concept of FIELD_CONCEPT_PATTERNS) {
      if (!concept.patterns.some(pattern => pattern.test(text))) continue

      if (!conceptCounts.has(concept.concept)) {
        conceptCounts.set(concept.concept, {
          count: 0,
          examples: [],
          is_in_macro_events: concept.is_in_macro_events,
          schema_change_required: concept.schema_change_required,
        })
      }

      const entry = conceptCounts.get(concept.concept)!
      entry.count++

      if (entry.examples.length < 3) {
        const matchIdx = concept.patterns.reduce((idx, p) => {
          const m = text.search(p)
          return m >= 0 && (idx < 0 || m < idx) ? m : idx
        }, -1)
        if (matchIdx >= 0) {
          const snippet = text.slice(Math.max(0, matchIdx - 25), matchIdx + 75)
          entry.examples.push(snippet.replace(/\n/g, ' '))
        }
      }
    }
  }

  let candidates_written = 0
  const concepts_found = conceptCounts.size

  for (const [concept_name, data] of Array.from(conceptCounts.entries())) {
    if (data.count < FIELD_MIN_OCCURRENCES) continue

    const { data: existing } = await supabase
      .from('enterprise_field_candidates')
      .select('id, occurrence_count')
      .eq('institution_id', institutionId)
      .eq('concept_name', concept_name)
      .in('status', ['pending', 'linked'])
      .single()

    if (existing) {
      await supabase
        .from('enterprise_field_candidates')
        .update({
          occurrence_count: existing.occurrence_count + data.count,
          last_seen_at: new Date().toISOString(),
          example_signal_text: data.examples[0] ?? null,
        })
        .eq('id', existing.id)
    } else {
      const { error } = await supabase
        .from('enterprise_field_candidates')
        .insert({
          institution_id: institutionId,
          concept_name,
          occurrence_count: data.count,
          example_signal_text: data.examples[0] ?? null,
          macro_event_categories: [],
          is_in_macro_events: data.is_in_macro_events,
          schema_change_required: data.schema_change_required,
          status: data.is_in_macro_events ? 'linked' : 'pending',
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
      if (!error) candidates_written++
    }
  }

  return { concepts_found, candidates_written }
}

// ─── ORCHESTRATOR ─────────────────────────────────────────────────────────────

/**
 * Run both discovery engines for an institution.
 * Called after each enterprise sweep completes — fire-and-forget from the route.
 */
export async function runAdaptiveLearning(
  institutionId: string,
  lookbackDays = 30
): Promise<{
  cohort_candidates_found: number
  cohort_candidates_written: number
  field_concepts_found: number
  field_candidates_written: number
  duration_ms: number
}> {
  const start = Date.now()

  const [cohortResult, fieldResult] = await Promise.allSettled([
    discoverCohortCandidates(institutionId, lookbackDays),
    discoverFieldCandidates(institutionId, lookbackDays),
  ])

  const cohort = cohortResult.status === 'fulfilled'
    ? cohortResult.value
    : { candidates_found: 0, candidates_written: 0 }

  const field = fieldResult.status === 'fulfilled'
    ? fieldResult.value
    : { concepts_found: 0, candidates_written: 0 }

  if (cohortResult.status === 'rejected') {
    console.error('[adaptive-learning] Cohort discovery error:', cohortResult.reason)
  }
  if (fieldResult.status === 'rejected') {
    console.error('[adaptive-learning] Field discovery error:', fieldResult.reason)
  }

  return {
    cohort_candidates_found: cohort.candidates_found,
    cohort_candidates_written: cohort.candidates_written,
    field_concepts_found: field.concepts_found,
    field_candidates_written: field.candidates_written,
    duration_ms: Date.now() - start,
  }
}
