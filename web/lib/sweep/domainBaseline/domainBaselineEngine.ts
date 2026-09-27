// lib/sweep/domainBaseline/domainBaselineEngine.ts
// FF-065 — Main entry point for the domain baseline layer.
// Returns a cached profile if fresh, builds one via blind landscape discovery
// if missing or stale (older than 7 days).

import { getDomainProfile, upsertDomainProfile, isProfileStale, type DomainProfile } from './domainProfileManager'
import { runBlindLandscape } from './blindLandscape'

export type { DomainProfile }

export async function getDomainBaselineProfile(
  userId: string,
  objectiveId: string,
  domain: string,
  objectiveText: string
): Promise<DomainProfile> {
  const existing = await getDomainProfile(objectiveId, domain)

  if (existing && !isProfileStale(existing)) {
    console.log(`[FF-065] Domain profile cache hit for ${domain} — objective ${objectiveId}`)
    return existing
  }

  console.log(`[FF-065] Building domain baseline for ${domain} — objective ${objectiveId}`)

  const landscape = await runBlindLandscape(domain, objectiveText)
  const signalTaxonomy = buildSignalTaxonomy(domain)
  const expansionRules = buildExpansionRules(domain, landscape.geographicScope)

  const profile: DomainProfile = {
    userId,
    objectiveId,
    domain,
    namedEntities: landscape.namedEntities,
    keyDataSources: landscape.keyDataSources,
    signalTaxonomy,
    geographicScope: landscape.geographicScope,
    expansionRules,
  }

  await upsertDomainProfile(profile)

  console.log(`[FF-065] Domain baseline built — ${landscape.namedEntities.length} entities, ${landscape.keyDataSources.length} sources`)

  return profile
}

function buildSignalTaxonomy(domain: string): string[] {
  if (domain === 'elk_hunt') {
    return [
      'drought classification and water source status',
      'wildlife population estimate vs management target',
      'permit and tag availability changes',
      'adjacent unit conditions and elk movement',
      'weather pattern and seasonal transition timing',
      'cattle grazing allotment pull-off dates',
      'hunter pressure and road access conditions',
    ]
  }
  return ['general conditions', 'regulatory changes', 'market signals']
}

function buildExpansionRules(
  domain: string,
  geographicScope: DomainProfile['geographicScope']
): Record<string, unknown> {
  if (domain === 'elk_hunt') {
    return {
      expandToWatersheds: true,
      expandToAdjacentUnits: true,
      watershedSources: ['USGS SNOTEL', 'NOAA drought monitor'],
      adjacentUnitSources: ['Utah DWR unit reports'],
      expandedGeography: geographicScope,
    }
  }
  return {}
}
