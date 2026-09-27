// lib/sweep/domainEvents/domainEventRetriever.ts
// FF-066 — Retrieves historical domain events from external sources.
// Drought: direct NOAA Drought Monitor API (structured data, no LLM).
// Wildlife/habitat: Brave Search + Haiku extraction.

import { executeBraveSearch } from '@/lib/signals/braveSearch'
import Anthropic from '@anthropic-ai/sdk'

export interface DomainEvent {
  eventYear: number
  eventDate?: string
  source: string
  signalClass: string
  eventText: string
  geoTags: string[]
  sectorTags: string[]
  directionScore: number  // -3 to +3; negative = bad for objective
  impactConfidence: number // 0-100
  sourceUrl?: string
}

export async function retrieveDomainEvents(
  domain: string,
  geographicScope: { states: string[]; counties: string[] },
  lookbackYears: number = 5
): Promise<DomainEvent[]> {
  const currentYear = new Date().getFullYear()
  const startYear = currentYear - lookbackYears
  const events: DomainEvent[] = []

  if (domain === 'elk_hunt') {
    const geo = geographicScope.counties.slice(0, 2).join(' ') || 'Utah'

    // Drought: direct NOAA API — no LLM needed for structured government data
    const droughtEvents = await fetchNoaaDroughtEvents(startYear, currentYear)
    events.push(...droughtEvents)
    console.log(`[FF-066] NOAA drought API: ${droughtEvents.length} events (years ${startYear}–${currentYear - 1})`)

    // Wildlife/habitat: Brave + Haiku
    const queries = buildElkHuntHistoricalQueries(geo, startYear, currentYear)
    const results = await Promise.all(
      queries.map(async ({ query, year, signalClass }) => {
        try {
          const result = await executeBraveSearch(query)
          if (result) {
            console.log(`[FF-066] Brave: "${query.slice(0, 60)}" → ${result.length} chars`)
            return { result, year, signalClass }
          }
          return null
        } catch {
          return null
        }
      })
    )

    const rawData = results
      .filter(Boolean)
      .map(r => `YEAR: ${r!.year}\nSIGNAL CLASS: ${r!.signalClass}\nDATA: ${r!.result}`)
      .join('\n\n---\n\n')

    if (rawData) {
      const client = new Anthropic()
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Extract historical domain events from this data for an elk hunting intelligence system.

DOMAIN: elk_hunt
GEOGRAPHY: ${geo}, Utah
TIME RANGE: ${startYear} to ${currentYear}

RAW DATA:
${rawData.slice(0, 10000)}

Extract real events that affected elk hunting outcomes. Each event should be specific, dated, and from a named source.
Return ONLY valid JSON array:
[
  {
    "eventYear": 2021,
    "eventDate": "2021-08-15",
    "source": "Utah DWR",
    "signalClass": "WILDLIFE_MANAGEMENT",
    "eventText": "Utah DWR issues 450 emergency antlerless elk permits for northeastern Utah units due to severe drought conditions",
    "geoTags": ["UT", "Duchesne", "Uintah"],
    "sectorTags": ["wildlife", "hunting", "drought"],
    "directionScore": -2,
    "impactConfidence": 85,
    "sourceUrl": ""
  }
]

Only include events you can clearly identify from the data. Do not fabricate. If unsure about a date, use the year only (YYYY-01-01).
Signal classes: WILDLIFE_MANAGEMENT, DROUGHT_DECLARATION, WEATHER_EVENT, REGULATORY_CHANGE, LAND_ACCESS, HABITAT_CONDITION`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      console.log('[FF-066] Raw Haiku response (first 300 chars):', text.slice(0, 300))
      try {
        const arrayStart = text.indexOf('[')
        const arrayEnd = text.lastIndexOf(']')
        if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
          console.error('[FF-066] Event parse failed — no JSON array found in response:', text.slice(0, 200))
        } else {
          const jsonStr = text.slice(arrayStart, arrayEnd + 1)
          const parsed = JSON.parse(jsonStr) as DomainEvent[]
          if (Array.isArray(parsed)) {
            events.push(...parsed)
          }
        }
      } catch {
        console.error('[FF-066] Event parse failed:', text.slice(0, 200))
      }
    }

    const byClass: Record<string, number> = {}
    for (const e of events) { byClass[e.signalClass] = (byClass[e.signalClass] ?? 0) + 1 }
    console.log(`[FF-066] Retrieved ${events.length} historical events for ${domain} — by class: ${JSON.stringify(byClass)}`)
  }

  return events
}

function buildElkHuntHistoricalQueries(
  geo: string,
  startYear: number,
  currentYear: number
): { query: string; year: number; signalClass: string }[] {
  const queries: { query: string; year: number; signalClass: string }[] = []

  for (let year = startYear; year <= currentYear; year++) {
    queries.push({
      query: `Utah DWR elk permit changes emergency antlerless ${geo} ${year}`,
      year,
      signalClass: 'WILDLIFE_MANAGEMENT',
    })
  }

  queries.push({
    query: `Utah elk hunting unit conditions harvest report ${geo} ${startYear} ${currentYear}`,
    year: currentYear,
    signalClass: 'HABITAT_CONDITION',
  })

  // Thread 2: Utah DWR elk harvest
  for (let year = startYear; year <= currentYear; year++) {
    queries.push({
      query: `Utah DWR elk harvest report ${year} success rate population herd status`,
      year,
      signalClass: 'HABITAT_CONDITION',
    })
  }

  // Thread 3: Utah snowpack
  for (let year = startYear; year <= currentYear; year++) {
    queries.push({
      query: `Utah snowpack ${year} percent average water year drought impact wildlife`,
      year,
      signalClass: 'DROUGHT_DECLARATION',
    })
  }

  return queries
}

// Northeastern Utah counties that overlap elk hunting units 9-11 area
const DROUGHT_COUNTIES = [
  { name: 'Duchesne', fips: '49013' },
  { name: 'Daggett', fips: '49009' },
  { name: 'Uintah', fips: '49047' },
]

interface NoaaDroughtRow {
  MapDate: string
  FIPS: string
  County: string
  State: string
  D0: number
  D1: number
  D2: number
  D3: number
  D4: number
}

async function fetchNoaaDroughtEvents(
  startYear: number,
  currentYear: number
): Promise<DomainEvent[]> {
  const events: DomainEvent[] = []
  console.log(`[FF-066] fetchNoaaDroughtEvents entered — range ${startYear}–${currentYear - 1}`)

  for (let year = startYear; year < currentYear; year++) {
    console.log('[FF-066] NOAA drought fetch starting for year:', year)
    // Sept 1 captures summer drought peak — peak stress before elk season opens
    const url = `https://droughtmonitor.unl.edu/DmData/GISData.aspx?mode=table&aoi=county&date=${year}-09-01&state=UT`
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`[FF-066] NOAA drought API non-OK year=${year}: ${response.status}`)
        continue
      }
      const data = await response.json() as NoaaDroughtRow[]
      if (!Array.isArray(data)) {
        console.warn(`[FF-066] NOAA drought API unexpected format year=${year}`)
        continue
      }

      let yearEvents = 0
      for (const county of DROUGHT_COUNTIES) {
        const row = data.find(r => r.FIPS === county.fips || r.County === county.name)
        if (!row) continue

        let droughtLevel: 'D2' | 'D3' | 'D4' | null = null
        let droughtLabel = ''
        let pct = 0
        if (row.D4 > 10) { droughtLevel = 'D4'; droughtLabel = 'Exceptional Drought'; pct = row.D4 }
        else if (row.D3 > 10) { droughtLevel = 'D3'; droughtLabel = 'Extreme Drought'; pct = row.D3 }
        else if (row.D2 > 10) { droughtLevel = 'D2'; droughtLabel = 'Severe Drought'; pct = row.D2 }

        if (!droughtLevel) continue

        events.push({
          eventYear: year,
          eventDate: `${year}-09-01`,
          source: 'NOAA Drought Monitor',
          signalClass: 'DROUGHT_DECLARATION',
          eventText: `${droughtLabel} (${droughtLevel}) covering ${Math.round(pct)}% of ${county.name} County, UT as of September ${year}`,
          geoTags: ['UT', county.name],
          sectorTags: ['drought', 'wildlife', 'hunting'],
          directionScore: droughtLevel === 'D4' ? -3 : droughtLevel === 'D3' ? -2 : -1,
          impactConfidence: 95,
          sourceUrl: url,
        })
        yearEvents++
      }
      console.log(`[FF-066] NOAA drought year=${year}: ${yearEvents} significant events`)
    } catch (err) {
      console.error(`[FF-066] NOAA drought fetch failed year=${year}:`, err)
    }
  }

  return events
}
