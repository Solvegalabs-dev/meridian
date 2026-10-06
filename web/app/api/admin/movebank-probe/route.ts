import { NextResponse } from 'next/server';
import { haversineKm } from '@/lib/geo/distance';
import {
  hasMovebankCredentials,
  fetchMovebankStudiesDetailed,
  fetchMovebankEventsDetailed,
  fetchMovebankEventsForWindow,
  fetchMovebankIndividuals,
  fetchMovebankStudyMeta,
  fetchMovebankEventsVariant,
  fetchMovebankEventsForWindowDetailed,
  probeStudyAttribute,
  isCommercialSafeLicense,
  taxonMatchesAny,
  MOVEBANK_TAXON_NAMES,
  STUDY_QUERY_PARAM_NAMES,
  STUDY_META_ATTRIBUTES,
  STUDY_PARAM_SHAPES,
  DEFAULT_WINDOWED_EVENT_ATTRS,
  type MovebankStudy,
  type MovebankEventVariantOptions,
  type MovebankEventWithTaxon,
  type StudyAttributeProbeResult,
} from '@/lib/swarm/agents/outdoor/movebankCollarFetch';
import { topTaxonNameCounts, classifyMovebankError } from '@/lib/swarm/agents/outdoor/collar/jobRunner';
import { cooldownRemainingMs, registerMovebankFailure } from '@/lib/swarm/agents/outdoor/collar/lease';

// FF-093 addendum — live diagnostic probe so Jason can verify Movebank
// credentials, real license_type spellings, the license handshake, and the
// ITIS taxon names all work without needing a swarm run or a real objective.
// Never returns raw events, license text, or credentials. Makes zero
// database writes unless `record=true` is explicitly passed — the handshake
// itself still runs either way (Movebank requires it per session
// regardless), only the movebank_license_acceptances audit row is gated.
export const maxDuration = 120;

// Batch1b item 2 — attrs= allow-list for the windowed probe.
// Only these attribute names may be requested; anything else gets a 400 so
// Jason can test one attribute at a time without risk of sending a
// free-form attribute that Movebank treats as an error.
const WINDOWED_PROBE_ATTR_ALLOWLIST = new Set([
  'individual_id', 'timestamp', 'location_lat', 'location_long',
  'individual_taxon_canonical_name', 'individual_local_identifier',
  'tag_local_identifier', 'visible',
]);
// Matches fetchMovebankEventsForWindow's production attribute list exactly
// (single source of truth: DEFAULT_WINDOWED_EVENT_ATTRS from the library).
const DEFAULT_WINDOWED_PROBE_ATTRS = DEFAULT_WINDOWED_EVENT_ATTRS;

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
  const bisect = searchParams.get('bisect');
  const windowStartParam = searchParams.get('window_start');
  const windowEndParam = searchParams.get('window_end');
  const sensorParam = searchParams.get('sensor'); // '0' | '1' — default on (matches production)
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

  // Batch1b item 1 — STANDALONE windowed probe (P0).
  // When study_id + window_start + window_end are ALL present, run ONLY the
  // windowed probe and return immediately. This avoids the 31s full-study
  // path that timed out and triggered 429 cooldowns. probeOneStudy,
  // fetchMovebankStudyMeta, fetchMovebankIndividuals, and variants a-d are
  // NOT called in this mode.
  if (directStudyId && windowStartParam && windowEndParam) {
    report.mode = 'windowed_probe';
    report.study_id = directStudyId;

    // Respect lease/cooldown. Probe is manual — no lease taken — but the
    // cooldown must still be checked to avoid a request when Movebank is
    // in backoff. After any abort/timeout/429/5xx, set the cooldown (same
    // as the worker) so subsequent probe calls wait the right interval.
    const cooldownMs = await cooldownRemainingMs();
    if (cooldownMs > 0) {
      return NextResponse.json({ skipped: true, cooldown_remaining_ms: cooldownMs });
    }

    const windowStart = new Date(windowStartParam);
    const windowEnd = new Date(windowEndParam);
    if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
      report.error = 'window_start/window_end must be valid date strings';
      return NextResponse.json(report, { status: 400 });
    }

    // attrs= allow-list validation (item 2).
    const attrsParam = searchParams.get('attrs');
    let probeAttrs: string[];
    if (attrsParam) {
      const requested = attrsParam.split(',').map(a => a.trim()).filter(Boolean);
      const invalid = requested.filter(a => !WINDOWED_PROBE_ATTR_ALLOWLIST.has(a));
      if (invalid.length > 0) {
        report.error = `Unknown attrs: ${invalid.join(', ')}. Allowed: ${Array.from(WINDOWED_PROBE_ATTR_ALLOWLIST).join(', ')}`;
        return NextResponse.json(report, { status: 400 });
      }
      probeAttrs = requested;
    } else {
      probeAttrs = DEFAULT_WINDOWED_PROBE_ATTRS;
    }

    const sensorFilter = sensorParam !== '0';
    const windowProbeStart = Date.now();

    const result = await fetchMovebankEventsForWindowDetailed(
      directStudyId, windowStart, windowEnd,
      { licenseType: directLicenseType ?? undefined, record, sensorFilter, attrs: probeAttrs }
    );

    // Set cooldown on Movebank errors (no lease taken, cooldown still applies).
    if (result.error || result.handshake === 'error') {
      const kind = classifyMovebankError(new Error(result.error ?? 'Movebank error'));
      if (kind !== 'other') {
        await registerMovebankFailure(kind).catch(() => undefined);
      }
    }

    const scientificNames = MOVEBANK_TAXON_NAMES[species] ?? null;
    const speciesMatchEvents = scientificNames
      ? result.events.filter(e => e.taxonCanonicalName && scientificNames.some(n => n.toLowerCase() === e.taxonCanonicalName.toLowerCase()))
      : result.events;
    const inRadius = speciesMatchEvents.filter(e => haversineKm(lat, lon, e.lat, e.lon) <= EVENT_RADIUS_KM);

    report.windowed_probe = {
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      sensor_filter: sensorFilter,
      handshake: result.handshake,
      http_status_class: result.http_status_class,
      truncated: result.truncated,
      response_bytes: result.response_bytes,
      header_columns: result.header_columns,
      access_denied_message: result.access_denied_message,
      taxon_column_present: result.taxon_column_present,
      rows_fetched: result.events.length,
      rows_species_match: scientificNames ? speciesMatchEvents.length : null,
      rows_in_radius: inRadius.length,
      top_taxon_names: topTaxonNameCounts(result.events),
      attrs_used: result.attrs_used,
      elapsed_ms: Date.now() - windowProbeStart,
      ...(result.error && { error: result.error }),
    };

    report.elapsed_ms = Date.now() - start;
    return NextResponse.json(report);
  }

  // Fix round item 3 — bisect=study_meta: isolates whether a single study
  // attribute name is the problem, vs. the way the study itself is
  // identified. Per Jason's explicit instruction, a baseline call using only
  // `attributes=id` runs FIRST against the same study_id; if that fails,
  // bisecting individual attribute names would be meaningless (the problem
  // is study identification/access, not an attribute spelling), so this
  // reports the baseline failure and stops rather than bisecting further.
  // Every call here goes through probeStudyAttribute -> movebankRequest,
  // which already serializes and rate-limits every real Movebank call in
  // this codebase — "serially, with the normal spacing and cooldown" is the
  // default behavior, not something this route layers on top.
  if (bisect === 'study_meta') {
    if (!directStudyId) {
      report.error = 'bisect=study_meta requires a study_id parameter';
      return NextResponse.json(report, { status: 400 });
    }

    report.mode = 'bisect_study_meta';
    report.study_id = directStudyId;

    const baseline = await probeStudyAttribute(directStudyId, 'id');
    report.baseline = baseline;

    if (!baseline.ok) {
      report.note = 'Baseline attributes=id call failed — the problem is how this study is identified (study_id, credentials, or access), not a specific attribute name. Per-attribute bisection skipped.';
      report.elapsed_ms = Date.now() - start;
      return NextResponse.json(report);
    }

    // Batch1b item 3: probe each attribute as `id,<attr>` (always include `id`).
    // Evidence: baseline `attributes=id` succeeds; prior probes omitting `id` 5xx'd.
    const attributeResults: Record<string, StudyAttributeProbeResult | { skipped: true; reason: string }> = {};
    for (const attr of STUDY_META_ATTRIBUTES) {
      if (Date.now() - start > DEADLINE_MS) {
        attributeResults[attr] = { skipped: true, reason: 'deadline reached' };
        continue;
      }
      attributeResults[attr] = await probeStudyAttribute(directStudyId, `id,${attr}`);
    }
    report.attributes = attributeResults;
    report.elapsed_ms = Date.now() - start;
    return NextResponse.json(report);
  }

  // Fix round #2 — bisect=study_meta_params: the attribute-name bisection
  // above keeps the request SHAPE fixed; this instead varies the shape
  // while keeping the attribute fixed (taxon_ids), to isolate whether the
  // live HTTP 500s are caused by a missing `i_have_download_access=true`
  // and/or by filtering on `study_id=X` instead of `id=X`. Shapes run
  // serially in order A, B, C — each through probeStudyAttribute's own
  // movebankRequest call, so they inherit the same rate limit/serialization
  // as every other call in this codebase. The first shape that returns
  // ok:true is treated as "the shape that worked" and is re-tested once
  // more with license_terms. Still reports HTTP status class only, never a
  // response body.
  if (bisect === 'study_meta_params') {
    if (!directStudyId) {
      report.error = 'bisect=study_meta_params requires a study_id parameter';
      return NextResponse.json(report, { status: 400 });
    }

    report.mode = 'bisect_study_meta_params';
    report.study_id = directStudyId;
    // Batch1b item 3: all shapes now probe `attributes=id,taxon_ids` (not just
    // `taxon_ids`) — the hypothesis is that Movebank requires `id` in the list.
    // Shape D added: same as the plain baseline (study_id, no i_have_download_access)
    // but with `id,taxon_ids` — isolates whether the `id` prefix alone is enough.
    report.shape_definitions = {
      A: 'study_id=<id> + i_have_download_access=true + attributes=id,taxon_ids',
      B: 'id=<id> (not study_id) + attributes=id,taxon_ids',
      C: 'id=<id> + i_have_download_access=true + attributes=id,taxon_ids',
      D: 'study_id=<id> (no i_have_download_access) + attributes=id,taxon_ids',
    };

    const shapeIds: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const taxonResultsByShape: Record<string, StudyAttributeProbeResult> = {};
    let workingShapeId: 'A' | 'B' | 'C' | 'D' | null = null;

    for (const shapeId of shapeIds) {
      if (Date.now() - start > DEADLINE_MS) {
        taxonResultsByShape[shapeId] = { ok: false, http_status_class: 'error', elapsed_ms: 0 };
        continue;
      }
      const result = await probeStudyAttribute(directStudyId, 'id,taxon_ids', STUDY_PARAM_SHAPES[shapeId]);
      taxonResultsByShape[shapeId] = result;
      if (result.ok && !workingShapeId) workingShapeId = shapeId;
    }
    report.taxon_ids_by_shape = taxonResultsByShape;
    report.working_shape = workingShapeId;

    if (!workingShapeId) {
      report.note = 'None of shapes A/B/C/D changed the outcome for id,taxon_ids — see individuals_variants for the alternative entity_type=individual probe.';
    } else {
      report.license_terms_result = await probeStudyAttribute(directStudyId, 'id,license_terms', STUDY_PARAM_SHAPES[workingShapeId]);
      report.note = `Shape ${workingShapeId} worked for id,taxon_ids. fetchMovebankStudyMeta already updated to use attributes=id,... in this batch — confirm the license_terms_result above.`;
    }

    // Individuals call variants — test study-level taxon_canonical_name vs
    // event-level individual_taxon_canonical_name (both prefixed with id).
    const individualsVariants: Record<string, StudyAttributeProbeResult | { skipped: true; reason: string }> = {};
    for (const [variantName, attrStr] of [
      ['id,local_identifier,taxon_canonical_name', 'id,local_identifier,taxon_canonical_name'],
      ['id,local_identifier,individual_taxon_canonical_name', 'id,local_identifier,individual_taxon_canonical_name'],
    ] as const) {
      if (Date.now() - start > DEADLINE_MS) {
        individualsVariants[variantName] = { skipped: true, reason: 'deadline reached' };
        continue;
      }
      individualsVariants[variantName] = await probeStudyAttribute(
        directStudyId, attrStr, undefined, 'individual'
      );
    }
    report.individuals_variants = individualsVariants;
    report.elapsed_ms = Date.now() - start;
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

    // Fix round item 3 — optional windowed probe (window_start/window_end +
    // sensor=0|1), mirroring the Phase 2 job runner's own windowed fetch so
    // a specific (study, window) combination can be diagnosed directly.
    // Still subject to the same `record` gate as the rest of this route —
    // only the handshake's own acceptance write is gated, nothing else here
    // ever touches the database.
    if (windowStartParam && windowEndParam) {
      const windowStart = new Date(windowStartParam);
      const windowEnd = new Date(windowEndParam);
      const sensorFilter = sensorParam !== '0';

      if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
        report.windowed_probe = { error: 'window_start/window_end must be valid date strings' };
      } else {
        const windowProbeStart = Date.now();
        try {
          const { events, handshake, truncated } = await fetchMovebankEventsForWindow(
            directStudyId, windowStart, windowEnd, directLicenseType ?? undefined, record, sensorFilter
          );
          const windowScientificNames = MOVEBANK_TAXON_NAMES[species] ?? null;
          const speciesMatchEvents: MovebankEventWithTaxon[] = windowScientificNames
            ? events.filter(e => e.taxonCanonicalName && windowScientificNames.some(n => n.toLowerCase() === e.taxonCanonicalName.toLowerCase()))
            : events;
          const inRadius = speciesMatchEvents.filter(e => haversineKm(lat, lon, e.lat, e.lon) <= EVENT_RADIUS_KM);

          report.windowed_probe = {
            window_start: windowStart.toISOString(),
            window_end: windowEnd.toISOString(),
            sensor_filter: sensorFilter,
            handshake,
            truncated,
            rows_fetched: events.length,
            rows_species_match: windowScientificNames ? speciesMatchEvents.length : null,
            rows_in_radius: inRadius.length,
            top_taxon_names: topTaxonNameCounts(events),
            elapsed_ms: Date.now() - windowProbeStart,
          };
        } catch (err) {
          report.windowed_probe = { error: err instanceof Error ? err.message : 'unknown error' };
        }
      }
    }

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
