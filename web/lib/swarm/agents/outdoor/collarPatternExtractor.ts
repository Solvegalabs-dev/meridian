// FF-093 — Collar Pattern Extractor
// CALCULATED:movebank_collar_patterns → computeCollarPatterns()
// Fetches Movebank GPS collar studies/events for an objective's species + geo,
// bins movement by LOCAL hour-of-day, cross-references FF-080 thermal belt,
// and writes a row to collar_pattern_library. Drought calibration is applied
// at READ time in collarCalibration.ts, not here — see Fix 4 note below.
// Returns gps_fix_count as the agentRunner observation (so it flows through
// the standard hit/miss pipeline).
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';
import { encodeGeohash } from '@/lib/geo/geohash';
import { haversineKm } from '@/lib/geo/distance';
import { resolveTimezone } from '@/lib/geo/timezone';
import {
  resolveMovebankTaxon,
  hasMovebankCredentials,
  fetchMovebankStudies,
  fetchMovebankEvents,
  parseMovebankTimestamp,
  isCommercialSafeLicense,
  type MovebankStudy,
  type MovebankEvent,
} from './movebankCollarFetch';

// Bound external calls per run — Movebank studies can carry very large
// deployments; a monthly-cadence pattern refresh doesn't need every one.
const MAX_STUDIES_PER_RUN = 5;
const MAX_ELEVATION_SAMPLES = 30;
const STUDY_SEARCH_RADIUS_KM = 500; // coarse study-level filter (main_location_lat/long)
const EVENT_RADIUS_KM = 150;        // the real guard — applied per GPS fix, not per study centroid
const MIN_IN_RADIUS_FIXES = 500;
const MIN_IN_RADIUS_INDIVIDUALS = 3;
const OVERALL_DEADLINE_MS = 120000; // checked between studies; stop and use what's in hand if exceeded

// Full drought modifier table, always stored as-is. Calibration (read time,
// collarCalibration.ts) picks the entry for whatever the CURRENT drought
// level is when a brief is built — storing only the level observed at
// compute time meant later drought changes never took effect (Fix 4).
// These shifts are heuristics (collar GPS fixes carry no local drought
// metadata to derive them from), extrapolated linearly through D4.
const DROUGHT_MODIFIERS = {
  D0: { window_shift_hours: 0, elevation_shift_ft: 0 },
  D1: { window_shift_hours: -1, elevation_shift_ft: 200 },
  D2: { window_shift_hours: -2, elevation_shift_ft: 500 },
  D3: { window_shift_hours: -3, elevation_shift_ft: 800 },
  D4: { window_shift_hours: -4, elevation_shift_ft: 1100 },
};

// Heuristic constants — not derived from collar data. Whitetail/elk activity
// literature broadly supports a cool-weather-favors-movement pattern; exact
// thresholds are a reasonable starting point pending real correlation.
const TEMP_OPTIMAL_RANGE_F: [number, number] = [38, 62];
const TEMP_SUPPRESSION_F = 75;

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

// Local calendar hour/month for a UTC instant in a given IANA zone — DST is
// handled per-event by its own date, not by a single fixed offset.
export function localParts(date: Date, timeZone: string): { hour: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', month: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return {
    hour: parseInt(get('hour') ?? '0', 10) % 24,
    month: parseInt(get('month') ?? '1', 10),
  };
}

function groupPeaksIntoWindows(peakHours: number[], counts: number[], maxCount: number): PeakWindow[] {
  if (peakHours.length === 0) return [];
  const sorted = [...peakHours].sort((a, b) => a - b);

  const windows: PeakWindow[] = [];
  let windowStart = sorted[0];
  let prevHour = sorted[0];

  const flush = (endHour: number) => {
    windows.push({
      window_start_hour: windowStart,
      window_end_hour: endHour + 1,
      confidence: Math.round((counts[endHour] / maxCount) * 100) / 100,
      label: labelForWindow(windowStart),
    });
  };

  for (let i = 1; i < sorted.length; i++) {
    const hour = sorted[i];
    if (hour === prevHour + 1) { prevHour = hour; continue; }
    flush(prevHour);
    windowStart = hour;
    prevHour = hour;
  }
  flush(prevHour);
  return windows;
}

// Bins events by LOCAL hour-of-day (Fix 2 — was UTC, which put every window
// 6-7 hours off for Mountain-time hunters). Primary method: IQR outlier
// detection (hours above Q3 + 1.5*IQR). Fallback: hours at/above 1.5x the
// mean hourly count, for small/uniform samples where IQR finds nothing.
// Returns null (never an empty array) when no pattern is discernible — an
// empty peak_movement_windows must never be cached (Fix 6d).
export function extractMovementWindows(events: MovebankEvent[], timeZone: string): PeakWindow[] | null {
  const counts = new Array(24).fill(0);
  for (const e of events) {
    const { hour } = localParts(parseMovebankTimestamp(e.timestamp), timeZone);
    counts[hour]++;
  }

  const maxCount = Math.max(...counts, 1);
  const sorted = [...counts].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const iqrThreshold = q3 + 1.5 * iqr;

  let peakHours = counts
    .map((c, hour) => ({ hour, c }))
    .filter(({ c }) => c > iqrThreshold && c > 0)
    .map(({ hour }) => hour);

  if (peakHours.length === 0) {
    const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
    const meanThreshold = mean * 1.5;
    peakHours = counts
      .map((c, hour) => ({ hour, c }))
      .filter(({ c }) => c >= meanThreshold && c > 0)
      .map(({ hour }) => hour);
  }

  if (peakHours.length === 0) return null;

  return groupPeaksIntoWindows(peakHours, counts, maxCount);
}

function taxonMatches(study: MovebankStudy, scientificName: string): boolean {
  return study.taxonIds
    .split(',')
    .map(s => s.trim().toLowerCase())
    .includes(scientificName.toLowerCase());
}

export async function computeCollarPatterns(objectiveId?: string): Promise<number | null> {
  if (!objectiveId) return null;

  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from('objective_profiles')
    .select('taxonomy_key, lat, lon, state, hunt_unit_id')
    .eq('id', objectiveId)
    .maybeSingle();

  if (!profile?.taxonomy_key || profile.lat == null || profile.lon == null) return null;

  const taxon = resolveMovebankTaxon(profile.taxonomy_key as string);
  if (!taxon) return null;

  const lat = Number(profile.lat);
  const lon = Number(profile.lon);
  const geoHash = encodeGeohash(lat, lon, 5);
  const timeZone = resolveTimezone(profile.state as string | null, lat, lon);
  const seasonMonth = localParts(new Date(), timeZone).month;

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

  let allStudies: MovebankStudy[];
  try {
    allStudies = await fetchMovebankStudies();
  } catch (err) {
    console.error('[collarPatterns] study discovery failed:', err);
    return null;
  }

  const eligible = allStudies
    .filter(s => taxonMatches(s, taxon.scientificName))
    .filter(s => isCommercialSafeLicense(s.licenseType))
    .map(s => ({ study: s, distanceKm: haversineKm(lat, lon, s.lat as number, s.lon as number) }))
    .filter(s => s.distanceKm <= STUDY_SEARCH_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm || b.study.numberOfIndividuals - a.study.numberOfIndividuals)
    .slice(0, MAX_STUDIES_PER_RUN);

  if (eligible.length === 0) return null;

  const startTime = Date.now();
  const inRadiusEvents: MovebankEvent[] = [];
  const contributingStudies: MovebankStudy[] = [];

  for (const { study } of eligible) {
    if (Date.now() - startTime > OVERALL_DEADLINE_MS) break;

    let events: MovebankEvent[];
    try {
      events = await fetchMovebankEvents(study.id, study.licenseType);
    } catch (err) {
      console.error(`[collarPatterns] event fetch failed for study ${study.id}:`, err);
      continue;
    }

    // The real location guard — study.lat/lon is a coarse centroid; individual
    // GPS fixes are filtered to the objective's actual radius (Fix 3).
    const nearby = events.filter(e => haversineKm(lat, lon, e.lat, e.lon) <= EVENT_RADIUS_KM);
    if (nearby.length > 0) {
      inRadiusEvents.push(...nearby);
      contributingStudies.push(study);
    }
  }

  const individualIds = new Set(inRadiusEvents.map(e => e.individualId).filter(Boolean));

  // Minimum evidence gate — never write a pattern from a thin or unrelated
  // sample, and never fall back to global (non-local) data (Fix 3).
  if (inRadiusEvents.length < MIN_IN_RADIUS_FIXES || individualIds.size < MIN_IN_RADIUS_INDIVIDUALS) {
    return null;
  }

  const seasonEvents = inRadiusEvents.filter(e => localParts(parseMovebankTimestamp(e.timestamp), timeZone).month === seasonMonth);
  const eventsForBinning = seasonEvents.length > 0 ? seasonEvents : inRadiusEvents;

  const peakWindows = extractMovementWindows(eventsForBinning, timeZone);
  if (peakWindows === null) return null; // no discernible pattern — do not cache an empty one

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

  const confidenceTier = individualIds.size >= 200 ? 3 : individualIds.size >= 50 ? 2 : 1;

  const timestamps = eventsForBinning.map(e => parseMovebankTimestamp(e.timestamp).getUTCFullYear());
  const yearsCoverage = timestamps.length > 0
    ? `${Math.min(...timestamps)}–${Math.max(...timestamps)}`
    : 'unknown';

  const licenseTypes = Array.from(new Set(contributingStudies.map(s => s.licenseType).filter(Boolean)));
  const citations = contributingStudies.map(s => s.citation).filter(Boolean);
  const citationCredit = citations.length > 0
    ? citations.join('; ')
    : `Movebank stud${contributingStudies.length === 1 ? 'y' : 'ies'} ${contributingStudies.map(s => s.id).join(', ')}`;

  const { error: upsertError } = await supabase
    .from('collar_pattern_library')
    .upsert({
      species_taxon_key: taxon.speciesTaxonKey,
      geo_hash: geoHash,
      state_code: profile.state ?? null,
      unit_id: profile.hunt_unit_id ?? null,
      season_month: seasonMonth,
      valid_for_seasons: [seasonMonth],
      local_tz: timeZone,
      peak_movement_windows: peakWindows,
      median_bedding_ft: medianBeddingFt,
      bedding_p25_ft: beddingP25Ft,
      bedding_p75_ft: beddingP75Ft,
      elevation_migration_trend: 'stable',
      drought_modifiers: DROUGHT_MODIFIERS,
      temp_optimal_range_f: TEMP_OPTIMAL_RANGE_F,
      temp_suppression_f: TEMP_SUPPRESSION_F,
      thermal_belt_pct: thermalBeltPct,
      aligns_ff080: thermalBeltPct > 0.6,
      movebank_study_ids: contributingStudies.map(s => Number(s.id)),
      individual_count: individualIds.size,
      gps_fix_count: eventsForBinning.length,
      years_coverage: yearsCoverage,
      event_radius_km: EVENT_RADIUS_KM,
      license_types: licenseTypes,
      citation: citationCredit,
      data_owner_credit: citationCredit,
      confidence_tier: confidenceTier,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'species_taxon_key,geo_hash,season_month' });

  if (upsertError) console.error('[collarPatterns] upsert failed:', upsertError.message);

  return eventsForBinning.length;
}
