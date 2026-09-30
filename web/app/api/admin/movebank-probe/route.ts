import { NextResponse } from 'next/server';
import { haversineKm } from '@/lib/geo/distance';
import {
  hasMovebankCredentials,
  fetchMovebankStudiesDetailed,
  fetchMovebankEventsDetailed,
  fetchMovebankIndividuals,
  fetchMovebankStudyMeta,
  fetchMovebankEventsVariant,
  isCommercialSafeLicense,
  taxonMatchesAny,
  MOVEBANK_TAXON_NAMES,
  STUDY_QUERY_PARAM_NAMES,
  type MovebankStudy,
  type MovebankEventVariantOptions,
} from '@/lib/swarm/agents/outdoor/movebankCollarFetch';

// FF-093 addendum — live diagnostic probe so Jason can verify Movebank
// credentials, real license_type spellings, the license handshake, and the
// ITIS taxon names all work without needing a swarm run or a real objective.
// Never returns raw events, license text, or credentials. Makes zero
// database writes unless `record=true` is explicitly passed — the handshake
// itself still runs either way (Movebank requires it per session
// regardless), only the movebank_license_acceptances audit row is gated.
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
const NEAREST_SAMPLE_SIZE = 5;
const PRODUCTION_MAX_BYTES = 20 * 1024 * 1024; // matches fetchMovebankEventsDetailed's real cap — variant (a) mirrors production exactly
const DIAGNOSTIC_MAX_BYTES = 2 * 1024 * 1024;  // hard cap for variants b/c/d so a huge study can't blow the function

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
  record: boolean,
  distanceKm?: number
): Promise<StudyProbeResult> {
  const probeStart = Date.now();
  try {
    const { events, handshake } = await fetchMovebankEventsDetailed(studyId, licenseType ?? undefined, record);
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

type NearestStudy = {
  id: string;
  license_type: string;
  commercial_safe: boolean; // CUSTOM (and any other non-CC_0/CC_BY license) stays in the list, just clearly marked false
  distance_km: number;
  number_of_individuals: number;
  has_download_access: boolean;
};

type SpeciesProbeEntry = {
  query: string;
  match_type: 'exact_taxon' | 'substring';
  matching_studies: number;
  license_type_counts: Record<string, number>;
  within_500km: number;
  within_1000km: number;
  within_500km_by_license: Record<string, number>;
  eligible_within_500km: number; // CC_0/CC_BY only, within 500km
  nearest: NearestStudy[];       // up to 5 nearest matches overall — no names, citations, or contact info
};

function studyRowNumber(r: Record<string, string>, field: string): number {
  return parseInt(r[field] ?? '0', 10) || 0;
}

function probeSpecies(
  rawRows: Array<Record<string, string>>,
  query: string,
  matchType: 'exact_taxon' | 'substring',
  lat: number,
  lon: number
): SpeciesProbeEntry {
  const licenseTypeCounts: Record<string, number> = {};
  const within500ByLicense: Record<string, number> = {};
  let matchingStudies = 0;
  let within500km = 0;
  let within1000km = 0;
  let eligibleWithin500km = 0;
  const withDistance: NearestStudy[] = [];

  for (const r of rawRows) {
    const taxonIds = r.taxon_ids ?? '';
    const isMatch = matchType === 'exact_taxon' ? taxonMatchesAny(taxonIds, [query]) : taxonIds.toLowerCase().includes(query.toLowerCase());
    if (!isMatch) continue;

    matchingStudies++;
    const licenseType = r.license_type ?? '';
    const licenseKey = licenseType || '(empty)';
    licenseTypeCounts[licenseKey] = (licenseTypeCounts[licenseKey] ?? 0) + 1;

    const rLat = r.main_location_lat ? parseFloat(r.main_location_lat) : NaN;
    const rLon = r.main_location_long ? parseFloat(r.main_location_long) : NaN;
    if (isNaN(rLat) || isNaN(rLon)) continue;

    const distanceKm = haversineKm(lat, lon, rLat, rLon);
    withDistance.push({
      id: r.id,
      license_type: licenseType,
      commercial_safe: isCommercialSafeLicense(licenseType),
      distance_km: Math.round(distanceKm),
      number_of_individuals: studyRowNumber(r, 'number_of_individuals'),
      has_download_access: (r.i_have_download_access ?? '').toLowerCase() === 'true',
    });

    if (distanceKm <= 500) {
      within500km++;
      within500ByLicense[licenseKey] = (within500ByLicense[licenseKey] ?? 0) + 1;
      if (isCommercialSafeLicense(licenseType)) eligibleWithin500km++;
    }
    if (distanceKm <= 1000) within1000km++;
  }

  withDistance.sort((a, b) => a.distance_km - b.distance_km);

  return {
    query,
    match_type: matchType,
    matching_studies: matchingStudies,
    license_type_counts: licenseTypeCounts,
    within_500km: within500km,
    within_1000km: within1000km,
    within_500km_by_license: within500ByLicense,
    eligible_within_500km: eligibleWithin500km,
    nearest: withDistance.slice(0, NEAREST_SAMPLE_SIZE),
  };
}

// Item 4 — elk_family: Cervus elaphus + Cervus canadensis combined (the same
// list MOVEBANK_TAXON_NAMES.elk uses), deduplicated by study id in case a
// study somehow tagged both names. Only the two eligible counts are asked
// for here — per-name breakdowns already exist in species_probe.
function probeElkFamily(rawRows: Array<Record<string, string>>, lat: number, lon: number): { eligible_within_500km: number; eligible_within_1000km: number } {
  const elkNames = MOVEBANK_TAXON_NAMES.elk;
  const seenIds = new Set<string>();
  let eligible500 = 0;
  let eligible1000 = 0;

  for (const r of rawRows) {
    if (!taxonMatchesAny(r.taxon_ids ?? '', elkNames)) continue;
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);

    if (!isCommercialSafeLicense(r.license_type ?? '')) continue;

    const rLat = r.main_location_lat ? parseFloat(r.main_location_lat) : NaN;
    const rLon = r.main_location_long ? parseFloat(r.main_location_long) : NaN;
    if (isNaN(rLat) || isNaN(rLon)) continue;

    const distanceKm = haversineKm(lat, lon, rLat, rLon);
    if (distanceKm <= 500) eligible500++;
    if (distanceKm <= 1000) eligible1000++;
  }

  return { eligible_within_500km: eligible500, eligible_within_1000km: eligible1000 };
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
  // Off by default: a diagnostic probe run must make zero database writes.
  // The handshake itself still runs (Movebank requires it regardless), but
  // the accepted-license audit row is only written when explicitly asked.
  const record = searchParams.get('record') === 'true';

  const credentialsPresent = hasMovebankCredentials();
  const report: Record<string, unknown> = { credentials_present: credentialsPresent, lat, lon, record };

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
    report.study_probe = await probeOneStudy(directStudyId, directLicenseType, lat, lon, record);

    // Addendum 4 item 1 — zero-row diagnosis. Tells us whether a zero-row
    // result came from the time window, the sensor filter, access, or
    // attribute naming. Never returns rows, names, owner, or citation.
    const studyMeta = await fetchMovebankStudyMeta(directStudyId).catch((err: unknown) => ({
      error: err instanceof Error ? err.message : 'unknown error',
    }));

    let individuals: Awaited<ReturnType<typeof fetchMovebankIndividuals>> = [];
    let individualsError: string | null = null;
    try {
      individuals = await fetchMovebankIndividuals(directStudyId, directLicenseType ?? undefined);
    } catch (err) {
      individualsError = err instanceof Error ? err.message : 'unknown error';
    }

    // species defaults to 'elk' above even in direct-study mode, so
    // individuals_matching_species always answers against a real species
    // rather than requiring a separate param just for this.
    const directScientificNames = MOVEBANK_TAXON_NAMES[species] ?? null;
    const individualsMatchingSpecies = directScientificNames
      ? individuals.filter(i => i.taxonCanonicalName && directScientificNames.some(n => n.toLowerCase() === i.taxonCanonicalName.toLowerCase())).length
      : null;

    const variantDefs: Array<{ name: string; opts: MovebankEventVariantOptions }> = [
      { name: 'a_sensor_filter_and_timestamp_start_current', opts: { sensorFilter: true, timestampStart: true, maxBytes: PRODUCTION_MAX_BYTES } },
      { name: 'b_sensor_filter_no_timestamp_start', opts: { sensorFilter: true, timestampStart: false, maxBytes: DIAGNOSTIC_MAX_BYTES } },
      { name: 'c_no_sensor_filter_with_timestamp_start', opts: { sensorFilter: false, timestampStart: true, maxBytes: DIAGNOSTIC_MAX_BYTES } },
    ];
    const firstIndividual = individuals[0]?.localIdentifier;
    if (firstIndividual) {
      variantDefs.push({
        name: 'd_no_filters_single_individual',
        opts: { sensorFilter: false, timestampStart: false, individualLocalIdentifier: firstIndividual, maxBytes: DIAGNOSTIC_MAX_BYTES },
      });
    }

    const variantResults: Record<string, unknown> = {};
    for (const { name, opts } of variantDefs) {
      if (Date.now() - start > DEADLINE_MS) {
        variantResults[name] = { skipped: true, reason: 'deadline reached' };
        continue;
      }
      variantResults[name] = await fetchMovebankEventsVariant(directStudyId, opts, directLicenseType ?? undefined);
    }
    if (!firstIndividual) {
      variantResults.d_no_filters_single_individual = {
        skipped: true,
        reason: individualsError ? `individuals unavailable: ${individualsError}` : 'no individuals returned for this study',
      };
    }

    report.diagnostics = {
      study_meta: studyMeta,
      individuals_total: individuals.length,
      individuals_matching_species: individualsMatchingSpecies,
      individuals_error: individualsError,
      variants: variantResults,
    };

    report.elapsed_ms = Date.now() - start;
    return NextResponse.json(report);
  }

  report.species = species;
  const scientificNames = MOVEBANK_TAXON_NAMES[species];
  report.scientific_names = scientificNames ?? null;
  report.limit = limit;

  if (!scientificNames) {
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

    if (!taxonMatchesAny(s.taxonIds, scientificNames)) continue;
    speciesMatchCount++;

    const distanceKm = haversineKm(lat, lon, s.lat as number, s.lon as number);
    if (distanceKm <= STUDY_SEARCH_RADIUS_KM) nearby.push({ study: s, distanceKm });
  }

  nearby.sort((a, b) => a.distanceKm - b.distanceKm);

  // Addendum 4 item 4 — catalog determinism. A live probe found the row
  // count differ (8796 vs 1001) between two runs with identical CC_0/CC_BY/
  // CC_BY_NC counts and only CUSTOM differing (7874 vs 79) — reporting the
  // exact request params and the has/without-download-access split lets a
  // future diff explain (or rule out) a code change as the cause.
  let hasDownloadAccessCount = 0;
  let withoutDownloadAccessCount = 0;
  for (const r of catalog.rawRows) {
    if ((r.i_have_download_access ?? '').toLowerCase() === 'true') hasDownloadAccessCount++;
    else withoutDownloadAccessCount++;
  }

  report.study_catalog = {
    request_params: STUDY_QUERY_PARAM_NAMES,
    raw_row_count: catalog.rawRowCount,
    total_studies: catalog.studies.length, // after the coordinate-validity filter
    has_download_access_count: hasDownloadAccessCount,
    without_download_access_count: withoutDownloadAccessCount,
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

  // Cervus elaphus + Cervus canadensis combined — whitetail/mule deer are
  // never folded into this or any other combined grouping (they resolve as
  // their own independent species only; see resolveMovebankTaxon).
  report.elk_family = probeElkFamily(catalog.rawRows, lat, lon);

  const studyProbes: StudyProbeResult[] = [];
  for (const { study, distanceKm } of nearby.slice(0, limit)) {
    if (Date.now() - start > DEADLINE_MS) {
      report.deadline_reached = true;
      break;
    }
    studyProbes.push(await probeOneStudy(study.id, study.licenseType, lat, lon, record, distanceKm));
  }

  report.study_probes = studyProbes;
  report.elapsed_ms = Date.now() - start;

  return NextResponse.json(report);
}
