// Cache for UDWR lookups. Only user-triggered lookups reach the network; a fresh row is served
// without a call. Successful lookups are cached. Not-found and errors are not, so a typo or an
// outage is never stored.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isCacheFresh, udwrLookupEnabled } from './huntCode'
import { fetchHuntFromUdwr, type UdwrRecord } from './udwrLookup'

export type HuntLookupResult =
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'found'; record: UdwrRecord; cached: boolean }

type CacheRow = {
  hunt_code: string
  boundary_id: string | null
  season_text: string | null
  boundary_geojson: unknown | null
  fetched_at: string
}

export async function readCache(supabase: SupabaseClient, code: string): Promise<CacheRow | null> {
  const { data } = await supabase
    .from('udwr_hunt_cache')
    .select('hunt_code, boundary_id, season_text, boundary_geojson, fetched_at')
    .eq('hunt_code', code)
    .maybeSingle()
  return (data as CacheRow | null) ?? null
}

export async function lookupHuntNumberCached(
  supabase: SupabaseClient,
  code: string,
  deps: { env?: Record<string, string | undefined>; fetchFn?: typeof fetch; now?: Date } = {},
): Promise<HuntLookupResult> {
  if (!udwrLookupEnabled(deps.env ?? process.env)) return { status: 'disabled' }

  const row = await readCache(supabase, code)
  if (row && isCacheFresh(row.fetched_at, deps.now)) {
    return {
      status: 'found',
      cached: true,
      record: { season_text: row.season_text, boundary_id: row.boundary_id, boundary_geojson: row.boundary_geojson },
    }
  }

  const outcome = await fetchHuntFromUdwr(code, deps.fetchFn)
  if (outcome.status === 'not_found') return { status: 'not_found' }
  if (outcome.status === 'error') return { status: 'error' }

  const { error } = await supabase
    .from('udwr_hunt_cache')
    .upsert({
      hunt_code: code,
      boundary_id: outcome.record.boundary_id,
      season_text: outcome.record.season_text,
      boundary_geojson: outcome.record.boundary_geojson,
      fetched_at: (deps.now ?? new Date()).toISOString(),
    })
  if (error) console.error('[udwr] cache write failed:', error.message)
  return { status: 'found', cached: false, record: outcome.record }
}
