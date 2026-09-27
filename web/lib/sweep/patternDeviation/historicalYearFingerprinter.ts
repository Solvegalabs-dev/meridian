// lib/sweep/patternDeviation/historicalYearFingerprinter.ts
// FF-067 — Reads enterprise_macro_events for a specific year and produces a
// ConditionFingerprint using the same dimensions as currentConditionsExtractor.

import { createServiceClient } from '@/lib/supabase/server'
import { ConditionFingerprint } from './currentConditionsExtractor'

export async function fingerprintHistoricalYear(
  domain: string,
  year: number
): Promise<ConditionFingerprint> {
  const supabase = createServiceClient()
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const { data: events } = await supabase
    .from('enterprise_macro_events')
    .select('event_category, event_name, description, direction, magnitude, relevant_industries, affected_regions')
    .gte('event_date', yearStart)
    .lte('event_date', yearEnd)
    .like('source_series_id', `${domain.toUpperCase()}:%`)

  const fingerprint: ConditionFingerprint = {
    domain,
    year,
    droughtLevel: 'unknown',
    populationStatus: 'unknown',
    permitPressure: 'unknown',
    weatherPattern: 'unknown',
    accessConditions: 'unknown',
    economicPressure: 'unknown',
    rawSignals: [],
  }

  if (!events || events.length === 0) return fingerprint

  const allText = events
    .map(e => `${e.event_name} ${e.description}`)
    .join(' ')
    .toLowerCase()

  fingerprint.rawSignals = events.map(e => e.event_name as string)

  if (allText.includes('d4') || allText.includes('exceptional drought')) fingerprint.droughtLevel = 'D4'
  else if (allText.includes('d3') || allText.includes('extreme drought')) fingerprint.droughtLevel = 'D3'
  else if (allText.includes('d2') || allText.includes('severe drought')) fingerprint.droughtLevel = 'D2'
  else if (allText.includes('d1') || allText.includes('moderate drought')) fingerprint.droughtLevel = 'D1'
  else if (allText.includes('d0') || allText.includes('abnormally dry')) fingerprint.droughtLevel = 'D0'
  else if (allText.includes('no drought') || allText.includes('normal')) fingerprint.droughtLevel = 'none'
  else if (allText.includes('drought conditions') || allText.includes('drought impact') || allText.includes('drought')) fingerprint.droughtLevel = 'D2'

  const permitEvents = events.filter(e => e.event_category === 'policy_regulatory' || e.event_category === 'wildlife_management')
  if (permitEvents.some(e => {
    const t = `${e.event_name} ${e.description}`.toLowerCase()
    return (t.includes('additional') && t.includes('permit')) || (t.includes('antlerless') && t.includes('permit'))
  })) {
    fingerprint.permitPressure = 'elevated'
  }

  if (allText.includes('above') && allText.includes('objective')) fingerprint.populationStatus = 'above_target'
  else if (allText.includes('below') && allText.includes('objective')) fingerprint.populationStatus = 'below_target'

  const droughtEvents = events.filter(e => e.event_category === 'natural_disaster')
  fingerprint.weatherPattern = droughtEvents.length > 0 ? 'unfavorable' : 'neutral'

  return fingerprint
}
