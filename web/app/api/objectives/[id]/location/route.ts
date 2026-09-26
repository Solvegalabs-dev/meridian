// PATCH /api/objectives/[id]/location — FF-074 hunt location entry
// Sets lat/lon on objective_profiles and resolves the full geography (FF-089):
// NWS gridpoint, state/county, nearby USGS gauges + SNOTEL stations, elevation, hunt unit.
// All geo fields are rewritten together so nothing from a previous location lingers.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveFullGeography } from '@/lib/geo/locationResolver'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { lat?: unknown; lon?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (body.lat == null || body.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Latitude must be -90 to 90 and longitude -180 to 180.' }, { status: 400 })
  }

  // Ownership check via the user-scoped client
  const { data: obj } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Resolve before writing so lat/lon and gridpoint never disagree.
  // The NWS grid is required (weather targeting); the other sources are best-effort.
  const geo = await resolveFullGeography(lat, lon)
  if (!geo?.nws_grid_office) {
    return NextResponse.json(
      { error: 'Could not resolve an NWS forecast grid for those coordinates. Check they are inside the US and try again.' },
      { status: 422 }
    )
  }

  const service = createServiceClient()
  const { data: updated, error } = await service
    .from('objective_profiles')
    .update({
      lat,
      lon,
      ...geo,
    })
    .eq('objective_id', params.id)
    .select('lat, lon, nws_grid_office, nws_grid_x, nws_grid_y, nws_zone_id, state, county, usgs_gauge_ids, snotel_station_ids, elevation_ft_avg, hunt_unit_id')
    .maybeSingle()

  if (error) {
    console.error('[objectives/location] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) return NextResponse.json({ error: 'No objective profile found for this objective' }, { status: 404 })

  return NextResponse.json({ location: updated })
}
