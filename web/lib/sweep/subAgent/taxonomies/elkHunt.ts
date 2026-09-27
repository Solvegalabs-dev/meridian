// lib/sweep/subAgent/taxonomies/elkHunt.ts
// FF-064 — Signal taxonomy for elk hunt objectives.
// FF-064 Search Router — each query tagged with QueryType for source routing.
// 5 queries validated in FF-068, parameterized by geography extracted from the objective.

import { type QueryType } from '../searchRouter'

export interface ElkHuntQuery {
  id: string
  query: string
  queryType: QueryType
  contextFields?: string[]
}

export interface ElkHuntParams {
  unit?: string    // e.g. "Unit 10"
  state?: string   // e.g. "Utah"
  county?: string  // e.g. "Duchesne"
  species?: string // e.g. "elk"
  season?: string  // e.g. "archery"
  year?: number
}

export function buildElkHuntQueries(params: ElkHuntParams): ElkHuntQuery[] {
  const { unit = '', state = 'Utah', county = '', year = new Date().getFullYear() } = params
  const geo = [county, state].filter(Boolean).join(' ')
  const unitStr = unit || ''

  return [
    {
      id: 'elk-drought',
      query: `NOAA drought monitor ${geo} current ${year} severity classification`,
      queryType: 'government_structured',
      contextFields: ['state', 'county'],
    },
    {
      id: 'elk-population',
      query: `Utah DWR elk population estimate ${unitStr} ${year} target herd size`,
      queryType: 'government_structured',
      contextFields: ['unit', 'state'],
    },
    {
      id: 'elk-conditions',
      query: `What are current elk conditions in ${unitStr} ${state} ${year} water drought movement`,
      queryType: 'current_conditions',
      contextFields: ['unit', 'state', 'county'],
    },
    {
      id: 'elk-field-reports',
      query: `elk hunting ${unitStr} ${state} ${year} field reports local conditions`,
      queryType: 'news_local',
    },
    {
      id: 'elk-permits',
      query: `Utah DWR elk permits remaining ${unitStr} ${year} antlerless`,
      queryType: 'government_structured',
      contextFields: ['unit'],
    },
  ]
}

export function extractElkHuntParams(objective: {
  title: string
  notes?: string
  category: string
}): ElkHuntParams {
  const text = `${objective.title} ${objective.notes || ''}`.toLowerCase()

  const unitMatch = text.match(/unit\s*(\d+[a-z]?)/i)
  const unit = unitMatch ? `Unit ${unitMatch[1]}` : ''

  const countyMap: Record<string, string> = {
    'diamond mountain': 'Duchesne',
    'vernal': 'Uintah',
    'book cliffs': 'Uintah',
    'strawberry': 'Wasatch',
    'nine mile': 'Carbon',
  }
  let county = ''
  for (const [key, val] of Object.entries(countyMap)) {
    if (text.includes(key)) { county = val; break }
  }

  const season = text.includes('archery') ? 'archery' :
    text.includes('rifle') ? 'rifle' :
    text.includes('muzzleloader') ? 'muzzleloader' : ''

  return {
    unit,
    state: 'Utah',
    county,
    species: 'elk',
    season,
    year: new Date().getFullYear(),
  }
}
