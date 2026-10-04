// POST /api/hunts/lookup {code} — look up a UDWR hunt number. Login required. User-triggered only.
// Returns the display data and a found flag. Never returns boundary coordinates or the user's spots.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeHuntCode } from '@/lib/hunts/huntCode'
import { lookupHuntNumberCached } from '@/lib/hunts/udwrCache'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const code = normalizeHuntCode(body.code)
  if (!code) return NextResponse.json({ error: 'Hunt numbers look like EA2004: two letters and four digits.' }, { status: 400 })

  const result = await lookupHuntNumberCached(createServiceClient(), code)
  if (result.status === 'found') {
    return NextResponse.json({
      hunt_code: code,
      status: 'found',
      season_text: result.record.season_text,
      boundary_found: result.record.boundary_geojson != null,
      source: 'Utah DWR',
    })
  }
  return NextResponse.json({ hunt_code: code, status: result.status, season_text: null, boundary_found: false, source: 'Utah DWR' })
}
