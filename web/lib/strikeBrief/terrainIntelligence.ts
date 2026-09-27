import { createServiceClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/anthropic/client';

export type TerrainIntelligence = {
  bedding: string[];
  feeding: string[];
  corridors: string[];
  elevation_range: { min: number; max: number } | null;
};

type ElevationPoint = { lat: number; lng: number; elevation: number | null };
type TerrainCacheRow = {
  coordinate_key: string;
  elevation_data: object;
  terrain_interpretation: TerrainIntelligence;
  expires_at: string;
};

// USGS 3DEP point query — one coordinate
async function query3DEPPoint(lat: number, lng: number): Promise<number | null> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&includeDate=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json() as { value?: string | number };
    const val = Number(json.value);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

// 3x3 grid around center at 0.01° offsets (~1km radius)
export async function fetchTerrainElevation(lat: number, lng: number): Promise<ElevationPoint[]> {
  const offsets = [-0.01, 0, 0.01];
  const queries: Promise<ElevationPoint>[] = [];

  for (const dLat of offsets) {
    for (const dLng of offsets) {
      const pLat = Math.round((lat + dLat) * 10000) / 10000;
      const pLng = Math.round((lng + dLng) * 10000) / 10000;
      queries.push(
        query3DEPPoint(pLat, pLng).then(elevation => ({ lat: pLat, lng: pLng, elevation }))
      );
    }
  }

  const results = await Promise.all(queries);
  return results;
}

function buildTerrainPrompt(elevationGrid: ElevationPoint[], domain: string, geoContext: object): string {
  const valid = elevationGrid.filter(p => p.elevation !== null);
  const elevations = valid.map(p => p.elevation as number);
  const minElev = elevations.length ? Math.min(...elevations) : null;
  const maxElev = elevations.length ? Math.max(...elevations) : null;

  const gridStr = elevationGrid
    .map(p => `(${p.lat},${p.lng}): ${p.elevation !== null ? `${p.elevation}m` : 'no data'}`)
    .join('\n');

  return `You are Meridian's terrain intelligence engine for the ${domain} domain.

ELEVATION GRID (9-point ~1km radius, USGS 3DEP data):
${gridStr}

Elevation range: ${minElev !== null ? `${minElev}m – ${maxElev}m` : 'insufficient data'}

GEO CONTEXT:
${JSON.stringify(geoContext, null, 2)}

TASK: Identify likely terrain features for elk/deer behavior based on elevation relief:

BEDDING TERRAIN rules:
- North-facing slopes (typically higher elevation on south side of grid)
- Saddles and benches between ridges
- Dark timber edges above open meadows
- Areas with significant elevation drop to south (sun-exposed slopes below = feeding pressure)

FEEDING AREA rules:
- South-facing slopes at lower elevation (sun exposure → grass/forb growth)
- Meadow/agricultural transitions
- Drainage bottoms near water sources

TRAVEL CORRIDOR rules:
- Ridge saddles (local elevation minimums between two higher points)
- Drainage bottoms and creek channels
- Bench traverses between elevation bands

Output JSON only — no markdown, no explanation outside the JSON:
{
  "bedding": ["description of likely bedding terrain 1", "..."],
  "feeding": ["description of likely feeding area 1", "..."],
  "corridors": ["description of likely travel corridor 1", "..."],
  "elevation_range": {"min": ${minElev ?? 0}, "max": ${maxElev ?? 0}}
}

Maximum 2-3 items per array. Be specific to the elevation data provided.`;
}

export async function interpretTerrain(
  elevationGrid: ElevationPoint[],
  domain: string,
  geoContext: object
): Promise<TerrainIntelligence> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: buildTerrainPrompt(elevationGrid, domain, geoContext) }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('[TerrainIntel] Failed to parse JSON');

  const parsed = JSON.parse(raw.slice(start, end + 1)) as TerrainIntelligence;
  return {
    bedding: parsed.bedding ?? [],
    feeding: parsed.feeding ?? [],
    corridors: parsed.corridors ?? [],
    elevation_range: parsed.elevation_range ?? null,
  };
}

export async function interpretUserDescribedTerrain(
  userDescription: string,
  domain: string,
  domainProfile: object
): Promise<TerrainIntelligence> {
  const anthropic = getAnthropicClient();
  const prompt = `You are Meridian's terrain intelligence engine for the ${domain} domain.

USER-DESCRIBED TERRAIN:
${userDescription}

DOMAIN PROFILE:
${JSON.stringify(domainProfile, null, 2)}

Based on the user's terrain description, identify likely elk/deer behavior zones.
Apply T3 confidence — this is anecdotal field description, not confirmed survey data.

Output JSON only:
{
  "bedding": ["description 1", "..."],
  "feeding": ["description 1", "..."],
  "corridors": ["description 1", "..."],
  "elevation_range": null
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('[TerrainIntel] Failed to parse user-described JSON');

  const parsed = JSON.parse(raw.slice(start, end + 1)) as TerrainIntelligence;
  return {
    bedding: parsed.bedding ?? [],
    feeding: parsed.feeding ?? [],
    corridors: parsed.corridors ?? [],
    elevation_range: null,
  };
}

export async function getTerrainIntel(
  lat: number,
  lng: number,
  domain: string,
  domainProfile: object,
  userDescription?: string
): Promise<{ intel: TerrainIntelligence; source: '3DEP' | 'user_described' }> {
  const supabase = createServiceClient();
  const coordKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const now = new Date().toISOString();

  // Check cache
  const { data: cached } = await supabase
    .from('terrain_cache')
    .select('elevation_data, terrain_interpretation, expires_at')
    .eq('coordinate_key', coordKey)
    .maybeSingle();

  if (cached && (cached as TerrainCacheRow).expires_at > now) {
    return { intel: (cached as TerrainCacheRow).terrain_interpretation, source: '3DEP' };
  }

  // Attempt 3DEP
  try {
    const grid = await fetchTerrainElevation(lat, lng);
    const hasData = grid.some(p => p.elevation !== null);

    if (hasData) {
      const intel = await interpretTerrain(grid, domain, domainProfile);

      // Cache result
      await supabase.from('terrain_cache').upsert({
        coordinate_key: coordKey,
        elevation_data: grid,
        terrain_interpretation: intel,
        cached_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'coordinate_key' });

      return { intel, source: '3DEP' };
    }
  } catch (err) {
    console.error('[TerrainIntel] 3DEP fetch/interpret failed:', err);
  }

  // Fallback to user description
  if (userDescription) {
    const intel = await interpretUserDescribedTerrain(userDescription, domain, domainProfile);
    return { intel, source: 'user_described' };
  }

  // No data available
  return {
    intel: { bedding: [], feeding: [], corridors: [], elevation_range: null },
    source: 'user_described',
  };
}
