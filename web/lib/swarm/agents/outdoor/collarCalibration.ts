// FF-093 — Collar Calibration
// Config layer: reads collar_pattern_library (populated by collarPatternExtractor)
// and calibrates movement windows against current drought + temperature +
// FF-080 thermal belt conditions. Pure read — no Movebank network calls, safe
// to call on every brief build.
//
// Split into findCollarPattern (DB lookup) + calibrateCollarPattern (pure
// calc) so a caller can skip fetching current conditions (drought lookup)
// entirely when there's no pattern to calibrate against — a brief for an
// objective with no collar data should pay zero extra cost (Fix 6a).

import { createServiceClient } from '@/lib/supabase/server';
import { encodeGeohash, geohashPrecisionSteps } from '@/lib/geo/geohash';
import { resolveMovebankTaxon } from './movebankCollarFetch';
import { extractCurrentConditions } from '@/lib/sweep/patternDeviation/currentConditionsExtractor';

export type DroughtLevel = 'none' | 'D0' | 'D1' | 'D2' | 'D3' | 'D4' | 'unknown';

export type CollarPatternRow = {
  peak_movement_windows: Array<{ window_start_hour: number; window_end_hour: number; confidence: number; label: string }> | null;
  median_bedding_ft: number | null;
  bedding_p25_ft: number | null;
  bedding_p75_ft: number | null;
  drought_modifiers: Record<string, { window_shift_hours: number; elevation_shift_ft: number }> | null;
  temp_suppression_f: number | null;
  aligns_ff080: boolean | null;
  confidence_tier: number | null;
  local_tz: string | null;
  years_coverage: string | null;
  data_owner_credit: string | null;
};

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
  local_tz: string | null;
  pattern_found: boolean;
};

const EMPTY_OUTPUT: CollarCalibrationOutput = {
  calibrated_windows: [],
  bedding_zone: null,
  data_credit: '',
  confidence_tier: 0,
  local_tz: null,
  pattern_found: false,
};

const PATTERN_COLUMNS = 'peak_movement_windows, median_bedding_ft, bedding_p25_ft, bedding_p75_ft, drought_modifiers, temp_suppression_f, aligns_ff080, confidence_tier, local_tz, years_coverage, data_owner_credit';

// Windows are stored as local hours (Fix 2) — formatted directly, no further
// timezone conversion needed here.
function formatWindow(startHour: number, endHour: number): string {
  const fmt = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}00`;
  return `${fmt(startHour)}–${fmt(endHour)}`;
}

function priorityFromConfidence(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

// Signal chip values are display strings like "54°F" or "72" — Number()
// returns NaN on the former, silently dropping temperature suppression
// (Fix 6e). Pull the first signed number instead.
export function parseTempF(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return isNaN(n) ? undefined : n;
}

// DB lookup only — no drought/temperature conditions are fetched here.
// Callers should only pay for extractCurrentConditions() when this returns
// non-null (Fix 6a).
export async function findCollarPattern(
  taxonomyKey: string,
  lat: number,
  lon: number,
  seasonMonth: number
): Promise<CollarPatternRow | null> {
  const taxon = resolveMovebankTaxon(taxonomyKey);
  if (!taxon) return null;

  const supabase = createServiceClient();
  const geoHash = encodeGeohash(lat, lon, 5);
  const steps = geohashPrecisionSteps(geoHash, 5, 3);

  for (const hashStep of steps) {
    const { data } = await supabase
      .from('collar_pattern_library')
      .select(PATTERN_COLUMNS)
      .eq('species_taxon_key', taxon.speciesTaxonKey)
      .like('geo_hash', `${hashStep}%`)
      .eq('season_month', seasonMonth)
      .limit(1)
      .maybeSingle();
    if (data) return data as CollarPatternRow;
  }

  return null;
}

// Pure calculation — no DB access. Drought modifier is looked up against
// the CURRENT level at call time (the row always carries the full D0-D4
// table; Fix 4), so drought changes after the pattern was computed still
// apply correctly.
export function calibrateCollarPattern(
  row: CollarPatternRow,
  conditionModifiers: { droughtLevel?: DroughtLevel; currentTempF?: number } = {}
): CollarCalibrationOutput {
  const peakWindows = row.peak_movement_windows ?? [];
  const droughtLevel = conditionModifiers.droughtLevel;
  const droughtMods = row.drought_modifiers ?? {};
  // 'none' and 'unknown' intentionally fall through to no shift.
  const modifier = droughtLevel && droughtLevel in droughtMods ? droughtMods[droughtLevel] : null;

  const tempSuppressionF = row.temp_suppression_f;
  const tempSuppressed = tempSuppressionF != null
    && conditionModifiers.currentTempF != null
    && conditionModifiers.currentTempF > tempSuppressionF;

  const calibratedWindows = peakWindows.map(w => {
    const shift = modifier?.window_shift_hours ?? 0;
    const startHour = w.window_start_hour + shift;
    const endHour = w.window_end_hour + shift;
    const isMidday = startHour >= 10 && startHour < 15;
    const priority = tempSuppressed && isMidday ? 'low' : priorityFromConfidence(w.confidence);
    const shifted = shift !== 0;

    return {
      window: formatWindow(startHour, endHour),
      action: shifted
        ? `Collar-observed ${w.label} window (adjusted for drought)`
        : `Collar-observed ${w.label} window`,
      priority,
      collar_confidence: w.confidence,
      condition_adjusted: shifted || (tempSuppressed && isMidday),
    };
  });

  const medianFt = row.median_bedding_ft;
  const p25 = row.bedding_p25_ft;
  const p75 = row.bedding_p75_ft;
  const elevationShift = modifier?.elevation_shift_ft ?? 0;

  const beddingZone = medianFt != null ? {
    elevation_ft: medianFt + elevationShift,
    spread_ft: (p75 ?? medianFt) - (p25 ?? medianFt),
    thermal_belt_confirmed: !!row.aligns_ff080,
  } : null;

  const years = row.years_coverage ?? 'unknown';
  const credit = row.data_owner_credit ?? 'Movebank';

  return {
    calibrated_windows: calibratedWindows,
    bedding_zone: beddingZone,
    data_credit: `Movebank GPS collar data — ${credit} (${years})`,
    confidence_tier: row.confidence_tier ?? 1,
    local_tz: row.local_tz,
    pattern_found: true,
  };
}

export { EMPTY_OUTPUT as EMPTY_COLLAR_CALIBRATION };

export type CollarBriefAugmentation = {
  windows: Array<{ window: string; action: string; priority: 'high' | 'medium' | 'low' }>;
  credit: string | null;
};

const NO_AUGMENTATION: CollarBriefAugmentation = { windows: [], credit: null };

// Shared by every brief-building call site (lib/mip/briefPayload.ts and the
// Strike page's server-rendered mapBriefRow) so the "only pay for
// extractCurrentConditions when a pattern exists" behavior (Fix 6a) and the
// try/catch-everything-fails-open behavior live in exactly one place. A
// collar lookup/calibration failure must never break a brief.
export async function getCollarBriefAugmentation(
  taxonomyKey: string | null | undefined,
  lat: number | string | null | undefined,
  lon: number | string | null | undefined,
  domain: string | null | undefined,
  currentTempF?: number
): Promise<CollarBriefAugmentation> {
  if (!taxonomyKey || lat == null || lon == null) return NO_AUGMENTATION;

  try {
    const patternRow = await findCollarPattern(taxonomyKey, Number(lat), Number(lon), new Date().getMonth() + 1);
    if (!patternRow) return NO_AUGMENTATION;

    const conditions = await extractCurrentConditions(domain ?? 'elk_hunt', null);
    const calibration = calibrateCollarPattern(patternRow, { droughtLevel: conditions.droughtLevel, currentTempF });

    return {
      windows: calibration.calibrated_windows.map(w => ({ window: w.window, action: w.action, priority: w.priority })),
      credit: calibration.data_credit,
    };
  } catch (err) {
    console.error('[FF-093] collar brief augmentation failed, continuing without it:', err);
    return NO_AUGMENTATION;
  }
}
