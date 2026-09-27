/**
 * FF-041 Phase 2 — Tier II Bucket Computation
 * Takes raw enterprise_cases field values and returns bucket labels
 * for cohort matching. Bucket values must exactly match those in
 * enterprise_cohort_definitions.field_combination[].bucket_value
 */

export interface CaseBuckets {
  dti_bucket: string | null        // '<20%' | '20-29%' | '30-39%' | '40-49%' | '50%+'
  ltv_bucket: string | null        // '<80%' | '80-99%' | '100-110%' | '110-120%' | '120%+'
  vintage_bucket: string | null    // '≤2018' | '2019-2021' | '2022-2024' | '2025+'
  term_bucket: string | null       // '24-36mo' | '37-48mo' | '49-60mo' | '61-72mo' | '73-84mo'
  make_group: string | null        // 'Domestic' | 'Japanese' | 'Korean' | 'European' | 'Other'
  payment_streak_bucket: string    // '0' | '1-3' | '4-11' | '12+'
  times_30_dpd_bucket: string      // '0' | '1' | '2' | '3+'
}

export function computeBuckets(caseData: {
  dti_ratio?: number | null
  ltv_ratio?: number | null
  origination_date?: string | null
  loan_term_months?: number | null
  loan_data?: Record<string, unknown> | null
}): CaseBuckets {

  // DTI bucket
  let dti_bucket: string | null = null
  if (caseData.dti_ratio != null) {
    const dti = caseData.dti_ratio
    if (dti < 20) dti_bucket = '<20%'
    else if (dti < 30) dti_bucket = '20-29%'
    else if (dti < 40) dti_bucket = '30-39%'
    else if (dti < 50) dti_bucket = '40-49%'
    else dti_bucket = '50%+'
  }

  // LTV bucket
  let ltv_bucket: string | null = null
  if (caseData.ltv_ratio != null) {
    const ltv = caseData.ltv_ratio
    if (ltv < 80) ltv_bucket = '<80%'
    else if (ltv < 100) ltv_bucket = '80-99%'
    else if (ltv < 110) ltv_bucket = '100-110%'
    else if (ltv < 120) ltv_bucket = '110-120%'
    else ltv_bucket = '120%+'
  }

  // Vintage bucket (from origination_date)
  let vintage_bucket: string | null = null
  if (caseData.origination_date) {
    const year = new Date(caseData.origination_date).getFullYear()
    if (year <= 2018) vintage_bucket = '≤2018'
    else if (year <= 2021) vintage_bucket = '2019-2021'
    else if (year <= 2024) vintage_bucket = '2022-2024'
    else vintage_bucket = '2025+'
  }

  // Term bucket
  let term_bucket: string | null = null
  if (caseData.loan_term_months != null) {
    const t = caseData.loan_term_months
    if (t <= 36) term_bucket = '24-36mo'
    else if (t <= 48) term_bucket = '37-48mo'
    else if (t <= 60) term_bucket = '49-60mo'
    else if (t <= 72) term_bucket = '61-72mo'
    else term_bucket = '73-84mo'
  }

  // Make group (from loan_data.vehicle_make if present)
  const DOMESTIC = ['ford','chevrolet','chevy','gmc','dodge','chrysler','jeep','ram','lincoln','buick','cadillac']
  const JAPANESE = ['toyota','honda','nissan','mazda','subaru','mitsubishi','lexus','acura','infiniti']
  const KOREAN = ['hyundai','kia','genesis']
  const EUROPEAN = ['bmw','mercedes','mercedes-benz','volkswagen','vw','audi','volvo','porsche','land rover','jaguar']
  let make_group: string | null = null
  const rawMake = (caseData.loan_data?.vehicle_make as string | undefined)?.toLowerCase()
  if (rawMake) {
    if (DOMESTIC.some(m => rawMake.includes(m))) make_group = 'Domestic'
    else if (JAPANESE.some(m => rawMake.includes(m))) make_group = 'Japanese'
    else if (KOREAN.some(m => rawMake.includes(m))) make_group = 'Korean'
    else if (EUROPEAN.some(m => rawMake.includes(m))) make_group = 'European'
    else make_group = 'Other'
  }

  // Payment streak bucket (from loan_data.payment_streak_current)
  const streak = (caseData.loan_data?.payment_streak_current as number | undefined) ?? 0
  let payment_streak_bucket = '0'
  if (streak >= 12) payment_streak_bucket = '12+'
  else if (streak >= 4) payment_streak_bucket = '4-11'
  else if (streak >= 1) payment_streak_bucket = '1-3'

  // Times 30 DPD bucket (from loan_data.times_30_dpd)
  const dpd30 = (caseData.loan_data?.times_30_dpd as number | undefined) ?? 0
  let times_30_dpd_bucket = '0'
  if (dpd30 >= 3) times_30_dpd_bucket = '3+'
  else if (dpd30 >= 2) times_30_dpd_bucket = '2'
  else if (dpd30 >= 1) times_30_dpd_bucket = '1'

  return {
    dti_bucket, ltv_bucket, vintage_bucket, term_bucket,
    make_group, payment_streak_bucket, times_30_dpd_bucket
  }
}

/**
 * Build the full field map for cohort matching.
 * Combines stored enterprise_cases columns with computed buckets.
 * Returns a flat key-value object for comparison against
 * cohort_definition.field_combination[].
 */
export function buildCaseFieldMap(caseRow: {
  region?: string | null
  fico_band?: string | null
  income_band?: string | null
  employment_type?: string | null
  vehicle_class?: string | null      // maps to vehicle_model_class
  vehicle_category?: string | null
  dti_ratio?: number | null
  ltv_ratio?: number | null
  origination_date?: string | null
  loan_term_months?: number | null
  loan_data?: Record<string, unknown> | null
}): Record<string, string> {
  const buckets = computeBuckets(caseRow)
  const map: Record<string, string> = {}

  // Direct fields (stored columns — use as-is)
  if (caseRow.region) map['region'] = caseRow.region
  if (caseRow.fico_band) map['fico_band'] = caseRow.fico_band
  if (caseRow.income_band) map['income_band'] = caseRow.income_band
  if (caseRow.employment_type) map['employment_type'] = caseRow.employment_type
  if (caseRow.vehicle_class) map['vehicle_model_class'] = caseRow.vehicle_class
  if (caseRow.vehicle_category) map['vehicle_category'] = caseRow.vehicle_category

  // Optional fields from loan_data jsonb
  const ld = caseRow.loan_data ?? {}
  if (ld.vehicle_condition) map['vehicle_condition'] = ld.vehicle_condition as string
  if (ld.gap_insurance_flag) map['gap_insurance_flag'] = ld.gap_insurance_flag as string
  if (ld.residence_type) map['residence_type'] = ld.residence_type as string

  // Computed buckets
  if (buckets.dti_bucket) map['dti_bucket'] = buckets.dti_bucket
  if (buckets.ltv_bucket) map['ltv_bucket'] = buckets.ltv_bucket
  if (buckets.vintage_bucket) map['vintage_bucket'] = buckets.vintage_bucket
  if (buckets.term_bucket) map['term_bucket'] = buckets.term_bucket
  if (buckets.make_group) map['make_group'] = buckets.make_group
  map['payment_streak_bucket'] = buckets.payment_streak_bucket
  map['times_30_dpd_bucket'] = buckets.times_30_dpd_bucket

  return map
}
