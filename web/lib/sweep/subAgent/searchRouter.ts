// lib/sweep/subAgent/searchRouter.ts
// FF-064 Search Router — Central routing layer. Accepts a query + type, returns results
// from the appropriate source. Each call has a 10-second individual timeout.
// Never throws — always returns SearchResult, with error field on failure.

import { executeBraveSearch } from '@/lib/signals/braveSearch'
import { fetchPerplexity } from './sources/perplexity'
import { fetchDuckDuckGo } from './sources/duckduckgo'
import { fetchGovernmentData } from './sources/governmentApis'

export type QueryType =
  | 'government_structured'   // NOAA, DWR, SNOTEL, permit data → direct API
  | 'current_conditions'      // Perplexity — synthesized real-time state
  | 'news_local'              // Brave — recent field reports, local press
  | 'unstructured_discovery'  // Brave — blind landscape, entity extraction
  | 'fallback'                // DuckDuckGo Instant Answer API

export interface SearchResult {
  source: string
  query: string
  results: string
  confidence_tier: 'T1' | 'T2' | 'T3' | 'T4'
  latency_ms: number
  error?: string
}

export interface TypedQuery {
  id?: string
  query: string
  queryType: QueryType
  contextFields?: string[]
}

export async function routeSearch(
  query: string,
  queryType: QueryType,
  context?: { state?: string; county?: string; unit?: string; date?: string }
): Promise<SearchResult> {
  const start = Date.now()

  const wrap = (
    source: string,
    tier: SearchResult['confidence_tier'],
    fn: () => Promise<string>
  ): Promise<SearchResult> =>
    Promise.race([
      fn().then(results => ({
        source,
        query,
        results: results ?? '',
        confidence_tier: tier,
        latency_ms: Date.now() - start,
      })),
      new Promise<SearchResult>(resolve =>
        setTimeout(
          () =>
            resolve({
              source,
              query,
              results: '',
              confidence_tier: tier,
              latency_ms: Date.now() - start,
              error: 'timeout',
            }),
          10000
        )
      ),
    ])

  switch (queryType) {
    case 'government_structured':
      return wrap('NOAA/DWR/SNOTEL', 'T1', () =>
        fetchGovernmentData(query, context ?? {})
      )

    case 'current_conditions':
      return wrap('Perplexity', 'T3', () => fetchPerplexity(query))

    case 'news_local':
    case 'unstructured_discovery':
      return wrap('Brave', 'T3', () => executeBraveSearch(query))

    case 'fallback':
    default:
      return wrap('DuckDuckGo', 'T3', () => fetchDuckDuckGo(query))
  }
}
