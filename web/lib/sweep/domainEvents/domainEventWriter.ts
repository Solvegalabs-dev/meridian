// lib/sweep/domainEvents/domainEventWriter.ts
// FF-066 — Writes retrieved domain events into enterprise_macro_events.
//
// Real column schema (from information_schema):
//   event_date (date), event_category (text — constrained enum), event_name (text),
//   description (text), magnitude (integer 1-5), direction (text: positive/negative/neutral/mixed),
//   affected_regions (array), relevant_industries (array), source_name (text),
//   source_url (text), source_series_id (text), tags (array),
//   is_verified (boolean), is_recession_period (boolean)
//
// event_category CHECK constraint — must map to one of these valid values:
//   monetary_policy, inflation, labor_market, credit_conditions, vehicle_market,
//   energy, geopolitical, recession_marker, equity_market, housing, policy_regulatory,
//   natural_disaster, major_employer_event, energy_commodity, election_political,
//   judicial_regulatory, social_confidence, supply_chain, climate_regulatory,
//   global_conflict, housing_real_estate
//
// Dedup: check-then-insert on (event_date, event_category, source_name).
// The table's UNIQUE constraint includes metric_name which is always null for
// domain events — Postgres treats NULLs as distinct, so upsert cannot deduplicate.

import { createServiceClient } from '@/lib/supabase/server'
import type { DomainEvent } from './domainEventRetriever'

const SIGNAL_CLASS_TO_CATEGORY: Record<string, string> = {
  WILDLIFE_MANAGEMENT: 'policy_regulatory',
  DROUGHT_DECLARATION: 'natural_disaster',
  WEATHER_EVENT: 'natural_disaster',
  REGULATORY_CHANGE: 'policy_regulatory',
  LAND_ACCESS: 'policy_regulatory',
  HABITAT_CONDITION: 'climate_regulatory',
  POLICY_REGULATORY: 'policy_regulatory',
}

function toCategory(signalClass: string): string {
  return SIGNAL_CLASS_TO_CATEGORY[signalClass] ?? 'policy_regulatory'
}

export async function writeDomainEvents(
  events: DomainEvent[],
  domain: string
): Promise<number> {
  if (!events.length) return 0

  const supabase = createServiceClient()
  let written = 0

  for (const event of events) {
    const eventDate = event.eventDate ?? `${event.eventYear}-01-01`
    const eventCategory = toCategory(event.signalClass)
    const sourceName = event.source

    // Check-then-insert: avoid duplicates without relying on the compound
    // UNIQUE key (which includes nullable metric_name).
    const { data: existing } = await supabase
      .from('enterprise_macro_events')
      .select('id')
      .eq('event_date', eventDate)
      .eq('event_category', eventCategory)
      .eq('source_name', sourceName)
      .maybeSingle()

    if (existing) continue

    const magnitude = Math.min(5, Math.max(1, Math.abs(event.directionScore) + 1))
    const direction = event.directionScore > 0 ? 'positive'
      : event.directionScore < 0 ? 'negative'
      : 'neutral'

    const seriesId = `${domain.toUpperCase()}:${event.eventYear}:${event.signalClass}`

    const { error } = await supabase
      .from('enterprise_macro_events')
      .insert({
        event_date: eventDate,
        event_category: eventCategory,
        event_name: event.eventText.slice(0, 120),
        description: event.eventText,
        magnitude,
        direction,
        affected_regions: event.geoTags,
        relevant_industries: event.sectorTags,
        source_name: sourceName,
        source_url: event.sourceUrl ?? '',
        source_series_id: seriesId,
        tags: [domain, event.signalClass.toLowerCase(), ...event.geoTags.map(g => g.toLowerCase())],
        is_verified: event.impactConfidence >= 70,
        is_recession_period: false,
      })

    if (error) {
      console.error(`[FF-066] Failed to write event ${seriesId}:`, error.message)
    } else {
      written++
    }
  }

  console.log(`[FF-066] Wrote ${written}/${events.length} events for domain ${domain}`)
  return written
}
