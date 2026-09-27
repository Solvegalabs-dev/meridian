// lib/sweep/domainBaseline/domainProfileManager.ts
// FF-065 — Reads and writes domain profiles from domain_profiles table.
// Profiles are keyed (objective_id, domain) — one profile per objective per domain.

import { createServiceClient } from '@/lib/supabase/server'

export interface DomainProfile {
  id?: string
  userId: string
  objectiveId: string
  domain: string
  namedEntities: string[]
  keyDataSources: string[]
  signalTaxonomy: string[]
  geographicScope: {
    states: string[]
    counties: string[]
    watersheds?: string[]
    adjacentUnits?: string[]
  }
  expansionRules: Record<string, unknown>
  lastEnrichedAt?: string
}

export async function getDomainProfile(
  objectiveId: string,
  domain: string
): Promise<DomainProfile | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('domain_profiles')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('domain', domain)
    .single()

  if (error || !data) return null

  return {
    id: data.id as string,
    userId: data.user_id as string,
    objectiveId: data.objective_id as string,
    domain: data.domain as string,
    namedEntities: (data.named_entities as string[]) || [],
    keyDataSources: (data.key_data_sources as string[]) || [],
    signalTaxonomy: (data.signal_taxonomy as string[]) || [],
    geographicScope: (data.geographic_scope as DomainProfile['geographicScope']) || { states: [], counties: [] },
    expansionRules: (data.expansion_rules as Record<string, unknown>) || {},
    lastEnrichedAt: data.last_enriched_at as string | undefined,
  }
}

export async function upsertDomainProfile(profile: DomainProfile): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('domain_profiles')
    .upsert({
      user_id: profile.userId,
      objective_id: profile.objectiveId,
      domain: profile.domain,
      named_entities: profile.namedEntities,
      key_data_sources: profile.keyDataSources,
      signal_taxonomy: profile.signalTaxonomy,
      geographic_scope: profile.geographicScope,
      expansion_rules: profile.expansionRules,
      last_enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'objective_id,domain',
    })

  if (error) {
    console.error('[FF-065] Failed to upsert domain profile:', error)
  }
}

export function isProfileStale(profile: DomainProfile): boolean {
  if (!profile.lastEnrichedAt) return true
  const age = Date.now() - new Date(profile.lastEnrichedAt).getTime()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return age > sevenDays
}
