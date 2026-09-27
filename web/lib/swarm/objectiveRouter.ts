// Core — universal routing logic across all MIP verticals (elk, RE, auto, salmon, etc.)
// Third-vertical test: GoHunt and FishBrain consume same router contract — YES
import { createServiceClient } from '@/lib/supabase/server'

// Key name extracted from data_source_url placeholder patterns like FRED_API_KEY, EIA_API_KEY
function extractKeyName(dataSourceUrl: string | null): string | null {
  if (!dataSourceUrl) return null
  const match = dataSourceUrl.match(/([A-Z_]+_API_KEY)/)
  return match ? match[1] : null
}

function keyInEnv(keyName: string | null): boolean {
  if (!keyName) return true
  return !!process.env[keyName]
}

// Taxonomy fallback: elk.bull.archery.HD316 → elk.bull.archery → elk.bull → elk
function taxonomyFallbacks(taxonomyKey: string): string[] {
  const parts = taxonomyKey.split('.')
  const chain: string[] = []
  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join('.'))
  }
  return chain
}

function geoMatches(
  agentGeoScope: string,
  geo: { state?: string; unit?: string }
): boolean {
  if (agentGeoScope === 'national') return true
  if (agentGeoScope.startsWith('state:')) {
    const required = agentGeoScope.slice('state:'.length)
    return geo.state?.toUpperCase() === required.toUpperCase()
  }
  return true
}

export type AgentBuildStatus = 'ready' | 'partial' | 'queued'

export async function resolveAgentBundle(
  taxonomyKey: string,
  geo: { state?: string; unit?: string }
): Promise<{
  agents: string[]
  buildStatus: AgentBuildStatus
}> {
  const supabase = createServiceClient()
  const fallbacks = taxonomyFallbacks(taxonomyKey)

  // Load all live agents from registry
  const { data: allAgents } = await supabase
    .from('agent_registry')
    .select('agent_code, taxonomy_keys, geo_scope, data_source_url, requires_key')
    .eq('status', 'live')

  if (!allAgents || allAgents.length === 0) {
    return { agents: [], buildStatus: 'queued' }
  }

  // Match by most-specific taxonomy key first
  type AgentRow = {
    agent_code: string
    taxonomy_keys: string[]
    geo_scope: string
    data_source_url: string | null
    requires_key: boolean
  }

  let matched: AgentRow[] = []
  for (const fb of fallbacks) {
    const candidates = allAgents.filter((a) =>
      (a as AgentRow).taxonomy_keys.includes(fb)
    ) as AgentRow[]
    if (candidates.length > 0) {
      matched = candidates
      break
    }
  }

  if (matched.length === 0) {
    return { agents: [], buildStatus: 'queued' }
  }

  // Filter by geo match
  const geoFiltered = matched.filter((a) => geoMatches(a.geo_scope, geo))

  if (geoFiltered.length === 0) {
    // Taxonomy matched but no geo-compatible agents → Tier 2 (building)
    return { agents: matched.map((a) => a.agent_code), buildStatus: 'partial' }
  }

  // Tier assignment
  const ready: string[] = []
  const queued: string[] = []
  const needsGeoResolution: string[] = []

  for (const agent of geoFiltered) {
    if (agent.requires_key) {
      const keyName = extractKeyName(agent.data_source_url)
      if (!keyInEnv(keyName)) {
        // Tier 3: missing key → insert credential request
        queued.push(agent.agent_code)
        await supabase
          .from('agent_credential_requests')
          .insert({
            agent_key: agent.agent_code,
            credential_name: keyName ?? 'UNKNOWN_KEY',
            registration_url: agent.data_source_url,
            instructions: `Obtain ${keyName} and add to Vercel environment variables`,
            status: 'pending',
          })
          .select()
          .maybeSingle()
        continue
      }
    }

    // Tier 2: geo needs NWS gridpoint resolution (no lat/lon available yet)
    if (!geo.state && agent.geo_scope === 'national') {
      needsGeoResolution.push(agent.agent_code)
      continue
    }

    // Tier 1: ready
    ready.push(agent.agent_code)
  }

  const assignedAgents = [...ready, ...needsGeoResolution, ...queued]

  let buildStatus: AgentBuildStatus = 'ready'
  if (ready.length === 0 && queued.length === 0 && needsGeoResolution.length > 0) {
    buildStatus = 'partial'
  } else if (ready.length === 0 && needsGeoResolution.length === 0) {
    buildStatus = 'queued'
  } else if (queued.length > 0 || needsGeoResolution.length > 0) {
    buildStatus = 'partial'
  }

  return { agents: assignedAgents, buildStatus }
}
