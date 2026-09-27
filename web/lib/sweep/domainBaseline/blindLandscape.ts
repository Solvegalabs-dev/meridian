// lib/sweep/domainBaseline/blindLandscape.ts
// FF-065 — Phase 1: broad discovery query for a domain.
// No pre-loaded knowledge. Discovers players, data sources, and geography
// by querying broadly, then Haiku extracts named entities from the results.

import { executeBraveSearch } from '@/lib/signals/braveSearch'
import Anthropic from '@anthropic-ai/sdk'

export interface LandscapeDiscovery {
  namedEntities: string[]
  keyDataSources: string[]
  geographicScope: {
    states: string[]
    counties: string[]
    watersheds?: string[]
    adjacentUnits?: string[]
  }
  rawFindings: string
}

export async function runBlindLandscape(
  domain: string,
  objectiveText: string
): Promise<LandscapeDiscovery> {
  const queries = buildBlindLandscapeQueries(domain, objectiveText)

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        return await executeBraveSearch(q)
      } catch {
        return null
      }
    })
  )

  const combined = results.filter(Boolean).join('\n\n')

  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Extract structured domain intelligence from this landscape scan.

DOMAIN: ${domain}
OBJECTIVE: ${objectiveText}

RAW LANDSCAPE DATA:
${combined.slice(0, 8000)}

Return ONLY valid JSON:
{
  "namedEntities": ["agency name", "organization name", ...],
  "keyDataSources": ["url or source name", ...],
  "geographicScope": {
    "states": ["UT", ...],
    "counties": ["Duchesne", ...],
    "watersheds": ["Uinta Basin", ...],
    "adjacentUnits": ["Unit 9B", ...]
  },
  "rawFindings": "2-3 sentence summary of what the landscape scan found"
}`,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(clean) as LandscapeDiscovery
  } catch {
    console.error('[FF-065] Blind landscape parse failed:', text.slice(0, 200))
    return {
      namedEntities: [],
      keyDataSources: [],
      geographicScope: { states: [], counties: [] },
      rawFindings: '',
    }
  }
}

function buildBlindLandscapeQueries(domain: string, objectiveText: string): string[] {
  if (domain === 'elk_hunt') {
    const unitMatch = objectiveText.match(/unit\s*(\d+[a-z]?)/i)
    const unit = unitMatch ? `Unit ${unitMatch[1]}` : 'Utah elk hunting'

    return [
      `Utah DWR ${unit} elk management plan agencies responsible`,
      `${unit} Diamond Mountain elk hunting data sources reports`,
      `Utah elk hunting regulations agencies CWMU landowner access`,
      `${unit} adjacent elk units watershed geography`,
    ]
  }

  return [
    `${objectiveText.slice(0, 100)} key agencies organizations data sources`,
    `${domain} industry data reports regulatory bodies`,
  ]
}
