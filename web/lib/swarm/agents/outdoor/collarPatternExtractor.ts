// FF-093 — Collar Pattern Extractor
// CALCULATED:movebank_collar_patterns → computeCollarPatterns()
// Fetches Movebank GPS collar studies/events for an objective's species + geo,
// bins movement by hour-of-day, cross-references drought + FF-080 thermal belt,
// and writes a row to collar_pattern_library. Returns gps_fix_count as the
// agentRunner observation (so it flows through the standard hit/miss pipeline).
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';
import { encodeGeohash } from '@/lib/geo/geohash';
import { extractCurrentConditions } from '@/lib/sweep/patternDeviation/currentConditionsExtractor';
import {
  resolveMovebankTaxon,
  hasMovebankCredentials,
  fetchMovebankStudies,
  fetchMovebankEvents,
  type MovebankEvent,
} from './movebankCollarFetch';

// Bound external calls per run — Movebank studies can carry very large
// deployments; a monthly-cadence pattern refresh doesn't need every one.
const MAX_STUDIES_PER_RUN = 3;
const MAX_ELEVATION_SAMPLES = 30;

// Static drought modifiers (FF-093 spec heuristic — collar data doesn't carry
// local drought metadata, so these are applied uniformly rather than derived).
const DROUGHT_MODIFIERS: Record<string, { window_shift_hours: number; elevation_shift_ft: number }> = {
  D0: { window_shift_hours: 0, elevation_shift_ft: 0 },
  D1: { window_shift_hours: -1, elevation_shift_ft: 200 },
  D2: { window_shift_hours: -2, elevation_shift_ft: 500 },
  D3: { window_shift_hours: -3, elevation_shift_ft: 800 },
};

async function queryElevation(lat: number, lng: number): Promise<number | null> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Feet&includeDate=false`;
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

type PeakWindow = { window_start_hour: number; window_end_hour: number; confidence: number; label: string };

function labelForWindow(startHour: number): string {
  if (startHour >= 4 && startHour < 9) return 'pre-dawn thermal';
  if (startHour >= 9 && startHour < 16) return 'midday lull';
  if (startHour >= 16 && startHour < 20) return 'evening water';
  return 'nocturnal movement';
}

// Bins events by hour-of-day, flags hours above Q3 + 1.5*IQR as peaks (IQR
// method), then groups consecutive peak hours into labeled windows.
function extractMovementWindows(events: MovebankEvent[]): PeakWindow[] {
  const counts = new Array(24).fill(0);
  for (const e of events) {
    const hour = new Date(e.timestamp).getUTCHours();
    counts[hour]++;
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const peakThreshold = q3 + 1.5 * iqr;
  const maxCount = Math.max(...counts, 1);

  const peakHours = counts
    .map((c, hour) => ({ hour, c }))
    .filter(({ c }) => c > peakThreshold && c > 0);

  if (peakHours.length === 0) return [];

  const windows: PeakWindow[] = [];
  let windowStart = peakHours[0].hour;
  let prevHour = peakHours[0].hour;

  const flush = (endHour: number) => {
    windows.push({
      window_start_hour: windowStart,
      window_end_hour: endHour + 1,
      confidence: Math.round((counts[endHour] / maxCount) * 100) / 100,
      label: labelForWindow(windowStart),
    });
  };

  for (let i = 1; i < peakHours.length; i++) {
    const { hour } = peakHours[i];
    if (hour === prevHour + 1) {
      prevHour = hour;
      continue;
    }
    flush(prevHour);
    windowStart = hour;
    prevHour = hour;
  }
  flush(prevHour);

  return windows;
}

export async function computeCollarPatterns(objectiveId?: string): Promise<number | null> {
  if (!objectiveId) return null;

  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from('objective_profiles')
    .select('taxonomy_key, lat, lon, state, hunt_unit_id, domain')
    .eq('id', objectiveId)
    .maybeSingle();

  if (!profile?.taxonomy_key || profile.lat == null || profile.lon == null) return null;

  const taxon = resolveMovebankTaxon(profile.taxonomy_key as string);
  if (!taxon) return null;

  const lat = Number(profile.lat);
  const lon = Number(profile.lon);
  const geoHash = encodeGeohash(lat, lon, 5);
  const seasonMonth = new Date().getMonth() + 1;

  // Historical pattern already computed for this species/geo/month — no need
  // to re-hit Movebank (patterns are stable; expires_at is null by design).
  const { data: existing } = await supabase
    .from('collar_pattern_library')
    .select('gps_fix_count')
    .eq('species_taxon_key', taxon.speciesTaxonKey)
    .eq('geo_hash', geoHash)
    .eq('season_month', seasonMonth)
    .maybeSingle();

  if (existing) return (existing.gps_fix_count as number | null) ?? 0;

  if (!hasMovebankCredentials()) return null;

  let studies;
  try {
    studies = await fetchMovebankStudies(taxon.taxonId);
  } catch (err) {
    console.error('[collarPatterns] study discovery failed:', err);
    return null;
  }
  if (!studies || studies.length === 0) return null;

  const selected = studies
    .filter(s => s.numberOfDeployedIndividuals > 0)
    .sort((a, b) => b.numberOfDeployedIndividuals - a.numberOfDeployedIndividuals)
    .slice(0, MAX_STUDIES_PER_RUN);

  const allEvents: MovebankEvent[] = [];
  const studyIds: number[] = [];
  const individualIds = new Set<string>();

  for (const study of selected) {
    try {
      const events = await fetchMovebankEvents(study.id);
      allEvents.push(...events);
      studyIds.push(Number(study.id));
      events.forEach(e => individualIds.add(e.individualId));
    } catch (err) {
      console.error(`[collarPatterns] event fetch failed for study ${study.id}:`, err);
    }
  }

  if (allEvents.length === 0) return null;

  const seasonEvents = allEvents.filter(e => new Date(e.timestamp).getUTCMonth() + 1 === seasonMonth);
  const eventsForBinning = seasonEvents.length > 0 ? seasonEvents : allEvents;

  const peakWindows = extractMovementWindows(eventsForBinning);

  // Elevation percentiles — sample a bounded subset to avoid excessive
  // external calls against thousands of raw GPS fixes.
  const sampleStep = Math.max(1, Math.floor(eventsForBinning.length / MAX_ELEVATION_SAMPLES));
  const sample = eventsForBinning.filter((_, i) => i % sampleStep === 0).slice(0, MAX_ELEVATION_SAMPLES);
  const elevations = (await Promise.all(sample.map(e => queryElevation(e.lat, e.lon))))
    .filter((e): e is number => e !== null)
    .sort((a, b) => a - b);

  const medianBeddingFt = elevations.length > 0 ? Math.round(percentile(elevations, 0.5)) : null;
  const beddingP25Ft = elevations.length > 0 ? Math.round(percentile(elevations, 0.25)) : null;
  const beddingP75Ft = elevations.length > 0 ? Math.round(percentile(elevations, 0.75)) : null;

  // FF-080 thermal belt cross-reference
  const { data: terrainRow } = await supabase
    .from('terrain_cache')
    .select('thermal_belt_min_ft, thermal_belt_max_ft')
    .eq('objective_id', objectiveId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let thermalBeltPct = 0;
  if (terrainRow?.thermal_belt_min_ft != null && terrainRow?.thermal_belt_max_ft != null && elevations.length > 0) {
    const inBelt = elevations.filter(
      e => e >= (terrainRow.thermal_belt_min_ft as number) && e <= (terrainRow.thermal_belt_max_ft as number)
    ).length;
    thermalBeltPct = Math.round((inBelt / elevations.length) * 1000) / 1000;
  }

  const conditions = await extractCurrentConditions(String(profile.domain ?? 'elk_hunt'), null);
  const droughtModifiers = conditions.droughtLevel in DROUGHT_MODIFIERS
    ? { [conditions.droughtLevel]: DROUGHT_MODIFIERS[conditions.droughtLevel] }
    : DROUGHT_MODIFIERS;

  const individualCount = individualIds.size;
  const confidenceTier = individualCount >= 200 ? 3 : individualCount >= 50 ? 2 : 1;

  const timestamps = eventsForBinning.map(e => new Date(e.timestamp).getFullYear());
  const yearsCoverage = timestamps.length > 0
    ? `${Math.min(...timestamps)}–${Math.max(...timestamps)}`
    : 'unknown';

  const { error: upsertError } = await supabase
    .from('collar_pattern_library')
    .upsert({
      species_taxon_key: taxon.speciesTaxonKey,
      geo_hash: geoHash,
      state_code: profile.state ?? null,
      unit_id: profile.hunt_unit_id ?? null,
      season_month: seasonMonth,
      valid_for_seasons: [seasonMonth],
      peak_movement_windows: peakWindows,
      median_bedding_ft: medianBeddingFt,
      bedding_p25_ft: beddingP25Ft,
      bedding_p75_ft: beddingP75Ft,
      elevation_migration_trend: 'stable',
      drought_modifiers: droughtModifiers,
      temp_optimal_range_f: [38, 62],
      temp_suppression_f: 75,
      thermal_belt_pct: thermalBeltPct,
      aligns_ff080: thermalBeltPct > 0.6,
      movebank_study_ids: studyIds,
      individual_count: individualCount,
      gps_fix_count: eventsForBinning.length,
      years_coverage: yearsCoverage,
      data_owner_credit: `Movebank study ${studyIds.join(', ')}`,
      confidence_tier: confidenceTier,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'species_taxon_key,geo_hash,season_month' });

  if (upsertError) console.error('[collarPatterns] upsert failed:', upsertError.message);

  return eventsForBinning.length;
}
