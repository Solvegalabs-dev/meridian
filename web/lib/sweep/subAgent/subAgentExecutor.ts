// lib/sweep/subAgent/subAgentExecutor.ts
// FF-064 — Core sub-agent engine: executes typed queries via searchRouter, synthesizes
// results into a structured signal brief via a Haiku call. Haiku is correct here —
// classification/synthesis of raw search results, not the main Engine 3 synthesis.
// FF-064 Search Router — replaces direct Brave calls with routeSearch().

import Anthropic from '@anthropic-ai/sdk'
import { routeSearch, type TypedQuery } from './searchRouter'

export interface SignalBrief {
  domain: string
  queriesRun: number
  keyFindings: string[]        // 3-5 most actionable findings
  patternObservation: string   // Does current condition match historical pattern?
  confidenceTier: 'T1' | 'T2' | 'T3' | 'T4'
  rawSummary: string           // Full synthesis for Layer 7
  sourcesConsulted: string[]
  executedAt: string           // ISO timestamp
}

export async function executeSubAgent(
  domain: string,
  queries: TypedQuery[],
  objectiveContext: string,
  structuredContext?: { state?: string; county?: string; unit?: string; date?: string }
): Promise<SignalBrief> {
  const client = new Anthropic()
  const searchResults: string[] = []
  const sourcesConsulted: string[] = []

  const queryResults = await Promise.allSettled(
    queries.map(async (q) => {
      const result = await routeSearch(q.query, q.queryType, structuredContext)
      return result.results ? { query: q.query, result: result.results, source: result.source, tier: result.confidence_tier } : null
    })
  )

  for (const settled of queryResults) {
    if (settled.status === 'fulfilled' && settled.value) {
      const { query, result, source } = settled.value
      searchResults.push(`QUERY: ${query}\nSOURCE: ${source}\nRESULT: ${result}`)
      sourcesConsulted.push(`${source}: ${query}`)
    }
  }

  console.log(`[FF-064] Search complete — ${searchResults.length}/${queries.length} queries returned results`)

  if (searchResults.length === 0) {
    return {
      domain,
      queriesRun: 0,
      keyFindings: [],
      patternObservation: 'No external signals retrieved — sub-agent queries failed.',
      confidenceTier: 'T4',
      rawSummary: '',
      sourcesConsulted: [],
      executedAt: new Date().toISOString(),
    }
  }

  const prompt = `You are an intelligence analyst synthesizing external signal data for a specific objective.

OBJECTIVE CONTEXT:
${objectiveContext}

DOMAIN: ${domain}

EXTERNAL SIGNAL DATA RETRIEVED:
${searchResults.join('\n\n---\n\n')}

Produce a structured signal brief. Be specific and factual. Only report what the data actually shows.
Use this exact JSON format:

{
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "patternObservation": "Does current condition match any historical pattern with a known outcome? If the matching year is too recent for outcome data (historical_outcome is null), state that explicitly — do not treat it as a predictive signal.",
  "confidenceTier": "T1|T2|T3|T4",
  "rawSummary": "2-3 sentence synthesis of all findings for injection into main sweep"
}

Confidence tiers:
T1 = Government/agency structured data with date
T2 = Verified field observation with timestamp
T3 = Reported/anecdotal, unverified
T4 = Modeled/inferred from pattern analysis

Base confidence tier on the LOWEST quality source used.
Be honest. Do not overstate certainty. Flag anything unverified.`

  console.log('[FF-064] Starting Haiku synthesis call')
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  })

  console.log('[FF-064] Haiku synthesis complete')
  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(clean)

    console.log(`[FF-064] Signal brief findings: ${JSON.stringify(parsed.keyFindings)}`)

    return {
      domain,
      queriesRun: searchResults.length,
      keyFindings: parsed.keyFindings || [],
      patternObservation: parsed.patternObservation || '',
      confidenceTier: parsed.confidenceTier || 'T4',
      rawSummary: parsed.rawSummary || '',
      sourcesConsulted,
      executedAt: new Date().toISOString(),
    }
  } catch {
    return {
      domain,
      queriesRun: searchResults.length,
      keyFindings: [],
      patternObservation: '',
      confidenceTier: 'T4',
      rawSummary: text.slice(0, 500),
      sourcesConsulted,
      executedAt: new Date().toISOString(),
    }
  }
}
