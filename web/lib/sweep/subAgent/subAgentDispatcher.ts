// lib/sweep/subAgent/subAgentDispatcher.ts
// FF-064 — Sub-agent orchestrator: detects domain, builds taxonomy queries,
// executes sub-agent, returns signal brief. Called before buildCoherencePackage.
// Failure is always non-fatal — sweep continues without the signal brief.
// Timeout (45s) is owned here so the call site needs no race logic.
// FF-065 — Wires in getDomainBaselineProfile for persistent domain intelligence.

import { detectDomain } from './domainDetector'
import { buildElkHuntQueries, extractElkHuntParams } from './taxonomies/elkHunt'
import { executeSubAgent, type SignalBrief } from './subAgentExecutor'
import { getDomainBaselineProfile } from '@/lib/sweep/domainBaseline/domainBaselineEngine'

export type { SignalBrief }

async function dispatchSubAgentInternal(objective: {
  id: string
  userId: string
  title: string
  category: string
  notes?: string
}): Promise<SignalBrief | null> {
  const domain = detectDomain(objective)

  if (domain === 'unknown') {
    return null
  }

  console.log(`[FF-064] Domain detected: ${domain} for objective ${objective.id}`)

  const objectiveContext = `Title: ${objective.title}\nCategory: ${objective.category}\nNotes: ${objective.notes || 'None'}`

  try {
    if (domain === 'elk_hunt') {
      const objectiveText = `${objective.title} ${objective.notes || ''}`

      const profile = await getDomainBaselineProfile(
        objective.userId,
        objective.id,
        domain,
        objectiveText
      ).catch(err => {
        console.error('[FF-065] Domain baseline failed — using default taxonomy:', err)
        return null
      })

      const params = extractElkHuntParams(objective)

      if (profile?.geographicScope?.counties?.length) {
        params.county = params.county || profile.geographicScope.counties[0]
      }

      const queries = buildElkHuntQueries(params)
      const agentStart = Date.now()

      const brief = await executeSubAgent(domain, queries, objectiveContext, {
        state: params.state,
        county: params.county,
        unit: params.unit,
      })

      const latency = Date.now() - agentStart
      const status = brief.queriesRun > 0 ? 'hit' : 'miss'
      const topSource = brief.sourcesConsulted[0]?.split(':')[0] ?? 'unknown'
      console.log(`[SubAgent] ${domain} completed in ${latency}ms via ${topSource} — ${status}`)

      return brief
    }

    // Future domains added here in subsequent FFs
    return null

  } catch (err) {
    console.error(`[FF-064] Sub-agent dispatch failed for objective ${objective.id}:`, err)
    return null
  }
}

export async function dispatchSubAgent(objective: {
  id: string
  userId: string
  title: string
  category: string
  notes?: string
}): Promise<SignalBrief | null> {
  const timeoutPromise = new Promise<null>(resolve =>
    setTimeout(() => {
      console.warn(`[FF-064] Sub-agent timeout for objective ${objective.id} — returning null after 60s`)
      resolve(null)
    }, 60000)
  )

  return Promise.race([dispatchSubAgentInternal(objective), timeoutPromise])
}
