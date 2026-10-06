// FF-093 Phase 2 — study catalog cache (spec v2 section 5, batch 1 item 3).
// Fetches the whole Movebank study list via the existing
// fetchMovebankStudiesDetailed() choke point and caches it in
// movebank_study_catalog, so the planner (Batch 2) never re-downloads the
// ~20k-row catalog on the hot path — it just reads this table.
import { createServiceClient } from '@/lib/supabase/server';
import {
  fetchMovebankStudiesDetailed,
  taxonMatchesAny,
  isCommercialSafeLicense,
  parseMovebankTimestamp,
} from '../movebankCollarFetch';
import { haversineKm } from '@/lib/geo/distance';

const UPSERT_BATCH_SIZE = 500;

function parseMovebankDateOrNull(raw: string): string | null {
  if (!raw) return null;
  const d = parseMovebankTimestamp(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export type CatalogRefreshResult = {
  studiesFetched: number;
  rawRowCount: number;
  responseBytes: number;
  truncated: boolean;
  batchesUpserted: number;
};

export async function refreshCatalog(): Promise<CatalogRefreshResult> {
  // Always requests i_have_download_access=true — that's baked into
  // STUDY_QUERY_PARAMS in movebankCollarFetch.ts, not re-specified here, so
  // there's exactly one place that can drift from it.
  const { studies, rawRowCount, responseBytes, truncated } = await fetchMovebankStudiesDetailed();
  const supabase = createServiceClient();
  const fetchedAt = new Date().toISOString();

  let batchesUpserted = 0;
  for (let i = 0; i < studies.length; i += UPSERT_BATCH_SIZE) {
    const batch = studies.slice(i, i + UPSERT_BATCH_SIZE).map(s => ({
      study_id: Number(s.id),
      name: s.name,
      main_lat: s.lat,
      main_lon: s.lon,
      number_of_individuals: s.numberOfIndividuals,
      taxon_ids: s.taxonIds,
      license_type: s.licenseType,
      citation: s.citation,
      has_download_access: s.hasDownloadAccess,
      timestamp_first: parseMovebankDateOrNull(s.timestampFirstDeployedLocation),
      timestamp_last: parseMovebankDateOrNull(s.timestampLastDeployedLocation),
      fetched_at: fetchedAt,
    }));
    await supabase.from('movebank_study_catalog').upsert(batch, { onConflict: 'study_id' });
    batchesUpserted++;
  }

  return { studiesFetched: studies.length, rawRowCount, responseBytes, truncated, batchesUpserted };
}

export type EligibleStudy = {
  studyId: string;
  licenseType: string;
  distanceKm: number;
  numberOfIndividuals: number;
  timestampFirst: string | null;
  timestampLast: string | null;
};

type CatalogRow = {
  study_id: number;
  main_lat: number | null;
  main_lon: number | null;
  taxon_ids: string | null;
  license_type: string | null;
  number_of_individuals: number | null;
  timestamp_first: string | null;
  timestamp_last: string | null;
};

// Pure DB read — no Movebank network call. Applies the same species-name
// match (multi-name aware), CC_0/CC_BY-only license allow-list, and
// haversine radius the Phase 1 extractor used, against the cached catalog
// instead of a fresh download.
export async function getEligibleStudies(
  scientificNames: string[],
  lat: number,
  lon: number,
  radiusKm = 500
): Promise<EligibleStudy[]> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('movebank_study_catalog').select('*');
  const rows = (data ?? []) as CatalogRow[];

  const eligible: EligibleStudy[] = [];
  for (const r of rows) {
    if (!r.taxon_ids || !taxonMatchesAny(r.taxon_ids, scientificNames)) continue;
    if (!r.license_type || !isCommercialSafeLicense(r.license_type)) continue;
    if (r.main_lat == null || r.main_lon == null) continue;

    const distanceKm = haversineKm(lat, lon, r.main_lat, r.main_lon);
    if (distanceKm > radiusKm) continue;

    eligible.push({
      studyId: String(r.study_id),
      licenseType: r.license_type,
      distanceKm,
      numberOfIndividuals: r.number_of_individuals ?? 0,
      timestampFirst: r.timestamp_first,
      timestampLast: r.timestamp_last,
    });
  }

  eligible.sort((a, b) => a.distanceKm - b.distanceKm || b.numberOfIndividuals - a.numberOfIndividuals);
  return eligible;
}
