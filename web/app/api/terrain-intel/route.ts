import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTerrainIntel } from '@/lib/strikeBrief/terrainIntelligence';

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    objectiveId?: string;
    lat?: number;
    lng?: number;
    userDescription?: string;
  };
  const { objectiveId, lat, lng, userDescription } = body;

  if (!objectiveId) return NextResponse.json({ error: 'objectiveId required' }, { status: 400 });
  if (lat === undefined && !userDescription) {
    return NextResponse.json({ error: 'coordinates or description required' }, { status: 400 });
  }

  // Verify ownership
  const { data: obj } = await supabase
    .from('objectives')
    .select('id')
    .eq('id', objectiveId)
    .eq('user_id', user.id)
    .single();

  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Load domain profile for context
  const { data: profile } = await supabase
    .from('domain_profiles')
    .select('domain, named_entities, geographic_scope, signal_taxonomy')
    .eq('objective_id', objectiveId)
    .maybeSingle();

  const domain = profile?.domain ?? 'elk_hunt';

  try {
    if (lat !== undefined && lng !== undefined) {
      const result = await getTerrainIntel(lat, lng, domain, profile ?? {}, userDescription);
      return NextResponse.json(result);
    } else {
      const result = await getTerrainIntel(0, 0, domain, profile ?? {}, userDescription);
      return NextResponse.json(result);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
