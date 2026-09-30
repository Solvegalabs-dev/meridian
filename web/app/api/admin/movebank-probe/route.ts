import { NextResponse } from 'next/server';
import { haversineKm } from '@/lib/geo/distance';
import {
  hasMovebankCredentials,
  fetchMovebankStudiesDetailed,
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
const TAXON_SAMPLE_SIZE = 50;

// Named binomials this agent actually maps to a taxonomy_key, plus
// Cervus elaphus (elk's Old-World name — some studies may tag it that way
// instead of the North American Cervus canadensis).
const SPECIES_PROBE_NAMES = [
  'Cervus canadensis', 'Cervus elaphus',
  'Odocoileus hemionus', 'Odocoileus virginianus',
  'Alces alces', 'Rangifer tarandus', 'Antilocapra americana',
];
const SPECIES_PROBE_SUBSTRINGS = ['cervus', 'odocoileus'];

function taxonMatches(taxonIdsRaw: string, scientificName: string): boolean {
  return taxonIdsRaw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .includes(scientificName.toLowerCase());
}

type StudyProbeResult = {
  study_id: string;
  license_type: string | null;
  commercial_safe: boolean | null;
  distance_km?: number;
  handshake_required?: boolean;
  handshake_result?: string;
  rows_returned?: number;
  in_radius_fixes?: number;
  distinct_individuals?: number;
  earliest_timestamp?: string | null;
  latest_timestamp?: string | null;
  elapsed_ms: number;
  error?: string;
};

async function probeOneStudy(
  studyId: string,
  licenseType: string | null,
  lat: number,
  lon: number,
  distanceKm?: number
): Promise<StudyProbeResult> {
  const probeStart = Date.now();
  try {
    const { events, handshake } = await fetchMovebankEventsDetailed(studyId, licenseType ?? undefined);
    const individualIds = new Set(events.map(e => e.individualId).filter(Boolean));
    const inRadius = events.filter(e => haversineKm(lat, lon, e.lat, e.lon) <= EVENT_RADIUS_KM);
    const timestamps = events.map(e => e.timestamp).sort();

    return {
      study_id: studyId,
      license_type: licenseType,
      commercial_safe: licenseType ? isCommercialSafeLicense(licenseType) : null,
      distance_km: distanceKm != null ? Math.round(distanceKm) : undefined,
      handshake_required: handshake !== 'not_required',
      handshake_result: handshake,
      rows_returned: events.length,
      in_radius_fixes: inRadius.length,
      distinct_individuals: individualIds.size,
      earliest_timestamp: timestamps[0] ?? null,
      latest_timestamp: timestamps[timestamps.length - 1] ?? null,
      elapsed_ms: Date.now() - probeStart,
    };
  } catch (err) {
    return {
      study_id: studyId,
      license_type: licenseType,
      commercial_safe: licenseType ? isCommercialSafeLicense(licenseType) : null,
      distance_km: distanceKm != null ? Math.round(distanceKm) : undefined,
      error: err instanceof Error ? err.message : 'unknown error',
      elapsed_ms: Date.now() - probeStart,
    };
  }
}

type SpeciesProbeEntry = {
  query: string;
  match_type: 'exact_taxon' | 'substring';
  matching_studies: number;
  license_type_counts: Record<string, number>;
  within_500km: number;
  within_1000km: number;
};

function probeSpecies(
  rawRows: Array<Record<string, string>>,
  query: string,
  matchType: 'exact_taxon' | 'substring',
  lat: number,
  lon: number
): SpeciesProbeEntry {
  const licenseTypeCounts: Record<string, number> = {};
  let matchingStudies = 0;
  let within500km = 0;
  let within1000km = 0;

  for (const r of rawRows) {
    const taxonIds = r.taxon_ids ?? '';
    const isMatch = matchType === 'exact_taxon' ? taxonMatches(taxonIds, query) : taxonIds.toLowerCase().includes(query.toLowerCase());
    if (!isMatch) continue;

    matchingStudies++;
    const licenseKey = r.license_type || '(empty)';
    licenseTypeCounts[licenseKey] = (licenseTypeCounts[licenseKey] ?? 0) + 1;

    const rLat = r.main_location_lat ? parseFloat(r.main_location_lat) : NaN;
    const rLon = r.main_location_long ? parseFloat(r.main_location_long) : NaN;
    if (!isNaN(rLat) && !isNaN(rLon)) {
      const distanceKm = haversineKm(lat, lon, rLat, rLon);
      if (distanceKm <= 500) within500km++;
      if (distanceKm <= 1000) within1000km++;
    }
  }

  return { query, match_type: matchType, matching_studies: matchingStudies, license_type_counts: licenseTypeCounts, within_500km: within500km, within_1000km: within1000km };
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
  const directStudyId = searchParams.get('study_id');
  const directLicenseType = searchParams.get('license_type');

  const credentialsPresent = hasMovebankCredentials();
  const report: Record<string, unknown> = { credentials_present: credentialsPresent, lat, lon };

  if (!credentialsPresent) {
    report.auth_ok = null;
    report.note = 'MOVEBANK_USERNAME/MOVEBANK_PASSWORD not set — cannot probe further.';
    return NextResponse.json(report);
  }

  // Direct single-study mode — skips catalog discovery entirely, so any
  // study (even one outside this agent's species/geo scope) can be used to
  // test the handshake on its own.
  if (directStudyId) {
    report.mode = 'direct_study';
    report.study_probe = await probeOneStudy(directStudyId, directLicenseType, lat, lon);
    report.elapsed_ms = Date.now() - start;
    return NextResponse.json(report);
  }

  report.species = species;
  const scientificName = MOVEBANK_TAXON_NAMES[species];
  report.scientific_name = scientificName ?? null;
  report.limit = limit;

  if (!scientificName) {
    report.error = `Unknown species key '${species}'. Valid: ${Object.keys(MOVEBANK_TAXON_NAMES).join(', ')}`;
    return NextResponse.json(report, { status: 400 });
  }

  let catalog;
  try {
    catalog = await fetchMovebankStudiesDetailed();
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

  for (const s of catalog.studies) {
    const key = s.licenseType || '(empty)';
    licenseTypeCounts[key] = (licenseTypeCounts[key] ?? 0) + 1;

    if (!taxonMatches(s.taxonIds, scientificName)) continue;
    speciesMatchCount++;

    const distanceKm = haversineKm(lat, lon, s.lat as number, s.lon as number);
    if (distanceKm <= STUDY_SEARCH_RADIUS_KM) nearby.push({ study: s, distanceKm });
  }

  nearby.sort((a, b) => a.distanceKm - b.distanceKm);

  report.study_catalog = {
    raw_row_count: catalog.rawRowCount,
    total_studies: catalog.studies.length, // after the coordinate-validity filter
    response_bytes: catalog.responseBytes,
    truncated: catalog.truncated,
    species_match_count: speciesMatchCount,
    within_500km_count: nearby.length,
    // Raw strings exactly as Movebank returns them — this is how we learn
    // the real CC_BY spelling (only CC_0 was confirmed from the docs alone).
    license_type_counts: licenseTypeCounts,
  };

  const taxonCounts = new Map<string, number>();
  let emptyTaxonIdsCount = 0;
  for (const r of catalog.rawRows) {
    const t = (r.taxon_ids ?? '').trim();
    if (t === '') { emptyTaxonIdsCount++; continue; }
    taxonCounts.set(t, (taxonCounts.get(t) ?? 0) + 1);
  }
  const taxonSample = Array.from(taxonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TAXON_SAMPLE_SIZE)
    .map(([taxon_ids, count]) => ({ taxon_ids, count }));

  report.taxon_sample = { top: taxonSample, empty_taxon_ids_count: emptyTaxonIdsCount };

  report.species_probe = [
    ...SPECIES_PROBE_NAMES.map(name => probeSpecies(catalog.rawRows, name, 'exact_taxon', lat, lon)),
    ...SPECIES_PROBE_SUBSTRINGS.map(word => probeSpecies(catalog.rawRows, word, 'substring', lat, lon)),
  ];

  const studyProbes: StudyProbeResult[] = [];
  for (const { study, distanceKm } of nearby.slice(0, limit)) {
    if (Date.now() - start > DEADLINE_MS) {
      report.deadline_reached = true;
      break;
    }
    studyProbes.push(await probeOneStudy(study.id, study.licenseType, lat, lon, distanceKm));
  }

  report.study_probes = studyProbes;
  report.elapsed_ms = Date.now() - start;

  return NextResponse.json(report);
}
