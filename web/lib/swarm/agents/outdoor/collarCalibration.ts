// FF-093 — Collar Calibration
// Config layer: reads collar_pattern_library (populated by collarPatternExtractor)
// and calibrates movement windows against current drought + temperature +
// FF-080 thermal belt conditions. Pure read — no Movebank network calls, safe
// to call on every brief build.

import { createServiceClient } from '@/lib/supabase/server';
import { encodeGeohash, geohashPrecisionSteps } from '@/lib/geo/geohash';

export type CollarCalibrationOutput = {
  calibrated_windows: Array<{
    window: string;
    action: string;
    priority: 'high' | 'medium' | 'low';
    collar_confidence: number;
    condition_adjusted: boolean;
  }>;
  bedding_zone: {
    elevation_ft: number;
    spread_ft: number;
    thermal_belt_confirmed: boolean;
  } | null;
  data_credit: string;
  confidence_tier: number;
  pattern_found: boolean;
};

const EMPTY_OUTPUT: CollarCalibrationOutput = {
  calibrated_windows: [],
  bedding_zone: null,
  data_credit: '',
  confidence_tier: 0,
  pattern_found: false,
};

function formatWindow(startHour: number, endHour: number): string {
  const fmt = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}00`;
  return `${fmt(startHour)}–${fmt(endHour)}`;
}

function priorityFromConfidence(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

export async function applyCollarCalibration(
  taxonomyKeyOrSpeciesKey: string,
  lat: number,
  lon: number,
  currentMonth: number,
  conditionModifiers: { droughtLevel?: 'none' | 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'unknown'; currentTempF?: number } = {}
): Promise<CollarCalibrationOutput> {
  const supabase = createServiceClient();
  const geoHash = encodeGeohash(lat, lon, 5);
  const steps = geohashPrecisionSteps(geoHash, 5, 3);

  // species_taxon_key in collar_pattern_library is coarser than a full
  // taxonomy_key (e.g. 'elk.bull' not 'elk.bull.archery.HD316') — try the
  // fully-qualified key first, then fall back to its first two segments.
  const speciesCandidates = [taxonomyKeyOrSpeciesKey, taxonomyKeyOrSpeciesKey.split('.').slice(0, 2).join('.')];

  let row: Record<string, unknown> | null = null;
  for (const speciesKey of Array.from(new Set(speciesCandidates))) {
    for (const hashStep of steps) {
      const { data } = await supabase
        .from('collar_pattern_library')
        .select('*')
        .eq('species_taxon_key', speciesKey)
        .like('geo_hash', `${hashStep}%`)
        .eq('season_month', currentMonth)
        .limit(1)
        .maybeSingle();
      if (data) { row = data; break; }
    }
    if (row) break;
  }

  if (!row) return EMPTY_OUTPUT;

  type Window = { window_start_hour: number; window_end_hour: number; confidence: number; label: string };
  const peakWindows = (row.peak_movement_windows as Window[] | null) ?? [];

  const droughtLevel = conditionModifiers.droughtLevel;
  const droughtMods = (row.drought_modifiers as Record<string, { window_shift_hours: number; elevation_shift_ft: number }> | null) ?? {};
  const modifier = droughtLevel && droughtLevel in droughtMods ? droughtMods[droughtLevel] : null;

  const tempSuppressionF = row.temp_suppression_f as number | null;
  const tempSuppressed = tempSuppressionF != null
    && conditionModifiers.currentTempF != null
    && conditionModifiers.currentTempF > tempSuppressionF;

  const calibratedWindows = peakWindows.map(w => {
    const shift = modifier?.window_shift_hours ?? 0;
    const startHour = w.window_start_hour + shift;
    const endHour = w.window_end_hour + shift;
    const isMidday = startHour >= 10 && startHour < 15;
    const priority = tempSuppressed && isMidday ? 'low' : priorityFromConfidence(w.confidence);

    return {
      window: formatWindow(startHour, endHour),
      action: `Collar-confirmed ${w.label} movement window`,
      priority,
      collar_confidence: w.confidence,
      condition_adjusted: shift !== 0 || (tempSuppressed && isMidday),
    };
  });

  const medianFt = row.median_bedding_ft as number | null;
  const p25 = row.bedding_p25_ft as number | null;
  const p75 = row.bedding_p75_ft as number | null;
  const elevationShift = modifier?.elevation_shift_ft ?? 0;

  const beddingZone = medianFt != null ? {
    elevation_ft: medianFt + elevationShift,
    spread_ft: (p75 ?? medianFt) - (p25 ?? medianFt),
    thermal_belt_confirmed: !!row.aligns_ff080,
  } : null;

  const years = (row.years_coverage as string | null) ?? 'unknown';
  const credit = (row.data_owner_credit as string | null) ?? 'Movebank';

  return {
    calibrated_windows: calibratedWindows,
    bedding_zone: beddingZone,
    data_credit: `Movebank GPS collar data — ${credit} (${years})`,
    confidence_tier: (row.confidence_tier as number | null) ?? 1,
    pattern_found: true,
  };
}
