// lib/sweep/domainEvents/domainEventEnrichment.ts
// FF-066 — Orchestrates domain event enrichment: checks freshness, retrieves
// historical events from external sources, writes to enterprise_macro_events.
// Re-enriches if no domain events found or if oldest batch is >30 days old.

import { getDomainProfile } from '@/lib/sweep/domainBaseline/domainProfileManager'
import { retrieveDomainEvents } from './domainEventRetriever'
import { writeDomainEvents } from './domainEventWriter'
import { createServiceClient } from '@/lib/supabase/server'

const ENRICHMENT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

export async function enrichDomainEvents(
  objectiveId: string,
  domain: string
): Promise<void> {
  if (domain === 'unknown') return

  const supabase = createServiceClient()

  const { data: recent } = await supabase
    .from('enterprise_macro_events')
    .select('created_at')
    .like('source_series_id', `${domain.toUpperCase()}:%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recent?.created_at) {
    const age = Date.now() - new Date(recent.created_at).getTime()
    if (age < ENRICHMENT_INTERVAL_MS) {
      console.log(`[FF-066] Domain events fresh for ${domain} — skipping enrichment`)
      return
    }
  }

  console.log(`[FF-066] Enriching domain events for ${domain}`)

  const profile = await getDomainProfile(objectiveId, domain)
  const geoScope = profile?.geographicScope ?? { states: ['UT'], counties: ['Duchesne'] }

  const events = await retrieveDomainEvents(domain, geoScope, 5)
  if (events.length > 0) {
    await writeDomainEvents(events, domain)
  }
}
