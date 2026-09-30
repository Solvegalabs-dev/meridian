import { NextResponse } from 'next/server';
import { haversineKm } from '@/lib/geo/distance';
import {
  hasMovebankCredentials,
  fetchMovebankStudies,
  fetchMovebankEventsDetailed,
  isCommercialSafeLicense,
  MOVEBANK_TAXON_NAMES,
  type MovebankStudy,
} from '@/lib/swarm/agents/outdoor/movebankCollarFetch';

// FF-093 addendum — live diagnostic probe so Jason can verify Movebank
// credentials, real license_type spellings, the license handshake, and the
// ITIS taxon names all work without needing a swarm run or a real objective.
// Never stores anything, never returns raw events or credentials.
export const maxDuration = 120;

const DEFAULT_LAT = 40.948;
const DEFAULT_LON = -110.668;
const STUDY_SEARCH_RADIUS_KM = 500; // mirrors collarPatternExtractor's study-level filter
const EVENT_RADIUS_KM = 150;        // mirrors collarPatternExtractor's real guard
const DEADLINE_MS = 110000;         // leaves headroom under maxDuration=120

function taxonMatches(taxonIdsRaw: string, scientificName: string): boolean {
  return taxonIdsRaw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .includes(scientificName.toLowerCase());
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat') ?? DEFAULT_LAT);
  const lon = Number(searchParams.get('lon') ?? DEFAULT_LON);
  const species = (searchParams.get('species') ?? 'elk').toLowerCase();
  const limit = Math.max(1, Math.min(10, Number(searchParams.get('limit') ?? 3) || 3));

  const scientificName = MOVEBANK_TAXON_NAMES[species];
  const credentialsPresent = hasMovebankCredentials();

  const report: Record<string, unknown> = {
    credentials_present: credentialsPresent,
    species,
    scientific_name: scientificName ?? null,
    lat, lon, limit,
  };

  if (!scientificName) {
    report.error = `Unknown species key '${species}'. Valid: ${Object.keys(MOVEBANK_TAXON_NAMES).join(', ')}`;
    return NextResponse.json(report, { status: 400 });
  }

  if (!credentialsPresent) {
    report.auth_ok = null;
    report.note = 'MOVEBANK_USERNAME/MOVEBANK_PASSWORD not set — cannot probe further.';
    return NextResponse.json(report);
  }

  let allStudies: MovebankStudy[];
  try {
    allStudies = await fetchMovebankStudies();
    report.auth_ok = 200;
  } catch (err) {
    // Error messages from this module never include credentials/cookies —
    // safe to surface directly (see movebankCollarFetch.ts movebankRequest).
    report.auth_ok = err instanceof Error ? err.message : 'error';
    return NextResponse.json(report, { status: 502 });
  }

  const licenseTypeCounts: Record<string, number> = {};
  let speciesMatchCount = 0;
  const nearby: Array<{ study: MovebankStudy; distanceKm: number }> = [];

  for (const s of allStudies) {
    const key = s.licenseType || '(empty)';
    licenseTypeCounts[key] = (licenseTypeCounts[key] ?? 0) + 1;

    if (!taxonMatches(s.taxonIds, scientificName)) continue;
    speciesMatchCount++;
    if (s.lat == null || s.lon == null) continue;

    const distanceKm = haversineKm(lat, lon, s.lat, s.lon);
    if (distanceKm <= STUDY_SEARCH_RADIUS_KM) nearby.push({ study: s, distanceKm });
  }

  nearby.sort((a, b) => a.distanceKm - b.distanceKm);

  report.study_catalog = {
    total_studies: allStudies.length,
    species_match_count: speciesMatchCount,
    within_500km_count: nearby.length,
    // Raw strings exactly as Movebank returns them — this is how we learn
    // the real CC_BY spelling (only CC_0 was confirmed from the docs alone).
    license_type_counts: licenseTypeCounts,
  };

  const studyProbes: unknown[] = [];
  for (const { study, distanceKm } of nearby.slice(0, limit)) {
    if (Date.now() - start > DEADLINE_MS) {
      report.deadline_reached = true;
      break;
    }

    const probeStart = Date.now();
    try {
      const { events, handshake } = await fetchMovebankEventsDetailed(study.id, study.licenseType);
      const individualIds = new Set(events.map(e => e.individualId).filter(Boolean));
      const inRadius = events.filter(e => haversineKm(lat, lon, e.lat, e.lon) <= EVENT_RADIUS_KM);
      const timestamps = events.map(e => e.timestamp).sort();

      studyProbes.push({
        study_id: study.id,
        license_type: study.licenseType,
        commercial_safe: isCommercialSafeLicense(study.licenseType),
        distance_km: Math.round(distanceKm),
        handshake_required: handshake !== 'not_required',
        handshake_result: handshake,
        rows_returned: events.length,
        in_radius_fixes: inRadius.length,
        distinct_individuals: individualIds.size,
        earliest_timestamp: timestamps[0] ?? null,
        latest_timestamp: timestamps[timestamps.length - 1] ?? null,
        elapsed_ms: Date.now() - probeStart,
      });
    } catch (err) {
      studyProbes.push({
        study_id: study.id,
        license_type: study.licenseType,
        distance_km: Math.round(distanceKm),
        error: err instanceof Error ? err.message : 'unknown error',
        elapsed_ms: Date.now() - probeStart,
      });
    }
  }

  report.study_probes = studyProbes;
  report.elapsed_ms = Date.now() - start;

  return NextResponse.json(report);
}
