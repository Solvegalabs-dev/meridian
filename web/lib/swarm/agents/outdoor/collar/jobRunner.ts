// FF-093 Phase 2 — collar job runner (spec v2 section 5 + amendments A1-A5).
// A job is (objective, species, study, time window). Each run claims ONE
// job via the atomic claim_collar_job() DB function, processes it through
// the existing Movebank choke point (movebankRequest — rate limiting,
// serialization, the license handshake), and writes a compact aggregate.
// No raw GPS fixes are ever persisted. Does NOT run the reducer or write
// collar_pattern_library — that's Batch 2.
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { decodeGeohash } from '@/lib/geo/geohash';
import { haversineKm } from '@/lib/geo/distance';
import {
  fetchMovebankEventsForWindow,
  fetchMovebankIndividuals,
  fetchMovebankStudyMeta,
  parseMovebankTimestamp,
  taxonMatchesAny,
  isCommercialSafeLicense,
  scientificNamesForSpeciesTaxonKey,
  type MovebankEventWithTaxon,
  type MovebankIndividual,
} from '../movebankCollarFetch';
import { registerMovebankFailure, type MovebankFailureKind } from './lease';

const EVENT_RADIUS_KM = 150;       // mirrors the Phase 1 extractor's real geo guard
const MAX_ELEVATION_SAMPLES = 30;
const ELEVATION_BATCH_SIZE = 5;    // USGS calls, not Movebank — concurrency here doesn't violate the one-Movebank-request rule
const MAX_SPLIT_DEPTH = 4;         // A1 — after this many halvings, a truncated window is dead, not split again
const RETRY_BACKOFF_MINUTES = [5, 30, 180]; // 5min, 30min, 3h, then dead

// ============================================================
// A1 — window building: season_month +/-1, intersected with the study's
// own [studyFirst, studyLast] range. Half-month windows (1st-15th,
// 16th-end-of-month). Handles year rollover (e.g. season_month=1 needs
// December of the PREVIOUS year) via native Date month-overflow arithmetic
// rather than manual mod-12 bookkeeping.
// ============================================================
export type TimeWindow = { start: Date; end: Date };

function shiftMonth(year: number, zeroIndexedMonth: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, zeroIndexedMonth, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function buildWindows(seasonMonth: number, studyFirst: Date | null, studyLast: Date | null): TimeWindow[] {
  if (!studyFirst || !studyLast) return [];
  if (studyFirst.getTime() > studyLast.getTime()) return [];

  const startYear = studyFirst.getUTCFullYear();
  const endYear = studyLast.getUTCFullYear();

  const seen = new Set<string>();
  const monthPairs: Array<{ year: number; month: number }> = [];
  for (let year = startYear; year <= endYear; year++) {
    for (const offset of [-1, 0, 1]) {
      const pair = shiftMonth(year, seasonMonth - 1 + offset);
      const key = `${pair.year}-${pair.month}`;
      if (!seen.has(key)) { seen.add(key); monthPairs.push(pair); }
    }
  }

  const windows: TimeWindow[] = [];
  for (const { year, month } of monthPairs) {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const midMonth = new Date(Date.UTC(year, month - 1, 16));
    const nextMonthStart = new Date(Date.UTC(year, month, 1));

    for (const [halfStart, halfEnd] of [[monthStart, midMonth], [midMonth, nextMonthStart]] as const) {
      const clippedStart = halfStart.getTime() > studyFirst.getTime() ? halfStart : studyFirst;
      const clippedEnd = halfEnd.getTime() < studyLast.getTime() ? halfEnd : studyLast;
      if (clippedStart.getTime() >= clippedEnd.getTime()) continue; // no overlap with the study's range
      windows.push({ start: clippedStart, end: clippedEnd });
    }
  }

  windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  return windows;
}

// A1 — truncation response: split in half, requeue both halves at
// split_depth+1. Never aggregate a truncated response (it's the start of
// the file, not a representative sample).
export function splitWindowInHalf(window: TimeWindow): [TimeWindow, TimeWindow] {
  const midMs = window.start.getTime() + (window.end.getTime() - window.start.getTime()) / 2;
  const mid = new Date(midMs);
  return [{ start: window.start, end: mid }, { start: mid, end: window.end }];
}

// ============================================================
// A2 — species filtering, in fallback order: (1) the event-level
// individual_taxon_canonical_name attribute (confirmed real in the docs),
// (2) the individuals table join (Phase 1's approach, kept as a fallback
// for when a study rejects the combined attribute set — this was observed
// live as an HTTP 500; the exact failing attribute could not be bisected
// without live credentials, so this stays a try/catch fallback rather than
// a verified root cause), (3) a genuinely single-species study. If none of
// those separate species, the job is marked dead rather than ever mixing
// species into one pattern.
// ============================================================
export type SpeciesFilterResult =
  | { outcome: 'filtered'; events: MovebankEventWithTaxon[] }
  | { outcome: 'dead'; reason: 'species_not_separable' };

export async function filterEventsBySpeciesForJob(
  studyId: string,
  studyTaxonIds: string,
  events: MovebankEventWithTaxon[],
  scientificNames: string[],
  licenseType?: string
): Promise<SpeciesFilterResult> {
  if (events.length === 0) return { outcome: 'filtered', events: [] };

  const withTaxon = events.filter(e => e.taxonCanonicalName);
  if (withTaxon.length > 0) {
    const matched = withTaxon.filter(e => scientificNames.some(n => n.toLowerCase() === e.taxonCanonicalName.toLowerCase()));
    return { outcome: 'filtered', events: matched };
  }

  // The event-level attribute came back empty for every row — fall back to
  // a separate individuals query.
  let individuals: MovebankIndividual[] = [];
  try {
    individuals = await fetchMovebankIndividuals(studyId, licenseType);
  } catch (err) {
    console.error(`[collar-worker] individuals fetch failed for study ${studyId}:`, err instanceof Error ? err.message : err);
  }

  const individualsWithTaxon = individuals.filter(i => i.taxonCanonicalName);
  if (individualsWithTaxon.length > 0) {
    const matchingIds = new Set(
      individualsWithTaxon
        .filter(i => scientificNames.some(n => n.toLowerCase() === i.taxonCanonicalName.toLowerCase()))
        .map(i => i.id)
    );
    return { outcome: 'filtered', events: events.filter(e => matchingIds.has(e.individualId)) };
  }

  // Both attribute sources are unavailable or empty — only trust a study
  // whose own taxon_ids lists exactly one species (and it's already
  // confirmed to match, since the job was only ever enqueued for an
  // eligible study).
  const taxonCount = studyTaxonIds.split(',').map(s => s.trim()).filter(Boolean).length;
  if (taxonCount === 1 && taxonMatchesAny(studyTaxonIds, scientificNames)) {
    return { outcome: 'filtered', events };
  }

  return { outcome: 'dead', reason: 'species_not_separable' };
}

// ============================================================
// Local-hour x month binning + years_present (A7) + elevation sampling.
// ============================================================
function localDateParts(date: Date, timeZone: string): { hour: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', month: 'numeric', year: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return {
    hour: parseInt(get('hour') ?? '0', 10) % 24,
    month: parseInt(get('month') ?? '1', 10),
    year: parseInt(get('year') ?? '1970', 10),
  };
}

function emptyHourlyCounts(): Record<string, number[]> {
  const counts: Record<string, number[]> = {};
  for (let m = 1; m <= 12; m++) counts[String(m)] = new Array(24).fill(0);
  return counts;
}

export type BinnedAggregate = {
  hourlyCounts: Record<string, number[]>;
  yearsPresent: number[];
  nFixes: number;
  individualIds: Set<string>;
  firstTs: Date | null;
  lastTs: Date | null;
};

export function binEventsForAggregate(events: MovebankEventWithTaxon[], localTz: string): BinnedAggregate {
  const hourlyCounts = emptyHourlyCounts();
  const years = new Set<number>();
  const individualIds = new Set<string>();
  let firstTs: Date | null = null;
  let lastTs: Date | null = null;

  for (const e of events) {
    const utcDate = parseMovebankTimestamp(e.timestamp);
    const { hour, month, year } = localDateParts(utcDate, localTz);
    hourlyCounts[String(month)][hour]++;
    years.add(year);
    if (e.individualId) individualIds.add(e.individualId);
    if (!firstTs || utcDate.getTime() < firstTs.getTime()) firstTs = utcDate;
    if (!lastTs || utcDate.getTime() > lastTs.getTime()) lastTs = utcDate;
  }

  return { hourlyCounts, yearsPresent: Array.from(years).sort((a, b) => a - b), nFixes: events.length, individualIds, firstTs, lastTs };
}

// Mirrors collarPatternExtractor.ts's queryElevation (USGS EPQS, not
// Movebank — concurrency here is fine). Kept as its own small copy rather
// than a shared export since it's ~10 lines and the two call sites have no
// other reason to couple.
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

export async function sampleElevations(events: Array<{ lat: number; lon: number }>): Promise<number[]> {
  if (events.length === 0) return [];
  const step = Math.max(1, Math.floor(events.length / MAX_ELEVATION_SAMPLES));
  const sample = events.filter((_, i) => i % step === 0).slice(0, MAX_ELEVATION_SAMPLES);

  const elevations: number[] = [];
  for (let i = 0; i < sample.length; i += ELEVATION_BATCH_SIZE) {
    const batch = sample.slice(i, i + ELEVATION_BATCH_SIZE);
    const results = await Promise.all(batch.map(e => queryElevation(e.lat, e.lon)));
    for (const r of results) if (r !== null) elevations.push(r);
  }
  return elevations;
}

// ============================================================
// A5 — record license acceptance from study metadata the first time a
// study is touched, since Movebank remembers acceptance per account and
// the handshake stops reappearing after the first real download (so an
// account that already accepted a study's terms outside this app's control
// — e.g. during an earlier diagnostic probe run with record=false — would
// otherwise never get an audit row at all).
// ============================================================
export async function ensureLicenseRecordedForStudy(studyId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('movebank_license_acceptances')
    .select('study_id')
    .eq('study_id', Number(studyId))
    .limit(1)
    .maybeSingle();
  if (existing) return;

  let meta;
  try {
    meta = await fetchMovebankStudyMeta(studyId);
  } catch (err) {
    console.error(`[collar-worker] study metadata fetch failed for ${studyId}, cannot pre-record license:`, err instanceof Error ? err.message : err);
    return; // not fatal — the event fetch's own handshake may still record it with source='handshake'
  }
  if (!meta?.licenseTerms) return;

  const md5 = createHash('md5').update(Buffer.from(meta.licenseTerms, 'utf-8')).digest('hex');
  await supabase
    .from('movebank_license_acceptances')
    .upsert(
      { study_id: Number(studyId), license_md5: md5, license_text: meta.licenseTerms, source: 'study_metadata' },
      { onConflict: 'study_id,license_md5', ignoreDuplicates: true }
    );
}

// ============================================================
// Claim / requeue — the atomic claim lives in a DB function
// (claim_collar_job, migration 20261001) so the race is a single UPDATE ...
// FOR UPDATE SKIP LOCKED statement, not a JS-level check-then-act.
// ============================================================
export type CollarJob = {
  id: string;
  objective_id: string;
  species_taxon_key: string;
  role: 'primary' | 'analog';
  study_id: number;
  geo_hash: string;
  local_tz: string;
  window_start: string;
  window_end: string;
  split_depth: number;
  status: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  last_error: string | null;
};

export async function requeueStaleJobs(): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('collar_jobs')
    .update({ status: 'queued', locked_until: null })
    .eq('status', 'running')
    .lt('locked_until', new Date().toISOString())
    .select('id');
  return (data ?? []).length;
}

export async function claimJob(): Promise<CollarJob | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('claim_collar_job');
  if (error) {
    console.error('[collar-worker] claim_collar_job RPC failed:', error.message);
    return null;
  }
  const row = data as CollarJob | null;
  if (!row || !row.id) return null; // the function returns an all-NULL row (not a true NULL) when nothing is claimable
  return row;
}

// ============================================================
// Failure classification + handling.
// ============================================================
export function classifyMovebankError(err: unknown): MovebankFailureKind | 'other' {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'timeout';
    if (err.name === 'AbortError') return 'abort';
    const statusMatch = err.message.match(/Movebank HTTP (\d+)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      if (status === 429) return '429';
      if (status >= 500) return '5xx';
    }
  }
  return 'other';
}

type CatalogRow = { license_type: string | null; taxon_ids: string | null; citation: string | null };

async function getCatalogRow(studyId: number): Promise<CatalogRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('movebank_study_catalog')
    .select('license_type, taxon_ids, citation')
    .eq('study_id', studyId)
    .maybeSingle();
  return data as CatalogRow | null;
}

async function enqueueSplitJobs(job: CollarJob, windows: TimeWindow[]): Promise<void> {
  const supabase = createServiceClient();
  const rows = windows.map(w => ({
    objective_id: job.objective_id,
    species_taxon_key: job.species_taxon_key,
    role: job.role,
    study_id: job.study_id,
    geo_hash: job.geo_hash,
    local_tz: job.local_tz,
    window_start: w.start.toISOString(),
    window_end: w.end.toISOString(),
    split_depth: job.split_depth + 1,
    status: 'queued',
  }));
  await supabase
    .from('collar_jobs')
    .upsert(rows, { onConflict: 'objective_id,species_taxon_key,study_id,window_start,window_end', ignoreDuplicates: true });
}

async function writeAggregate(job: CollarJob, catalogRow: CatalogRow, binned: BinnedAggregate, elevSamples: number[]): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('collar_study_aggregates')
    .upsert({
      study_id: job.study_id,
      species_taxon_key: job.species_taxon_key,
      geo_hash: job.geo_hash,
      local_tz: job.local_tz,
      window_start: job.window_start,
      window_end: job.window_end,
      hourly_counts: binned.hourlyCounts,
      years_present: binned.yearsPresent,
      n_fixes: binned.nFixes,
      n_individuals: binned.individualIds.size,
      event_radius_km: EVENT_RADIUS_KM,
      elev_samples: elevSamples,
      first_ts: binned.firstTs ? binned.firstTs.toISOString() : null,
      last_ts: binned.lastTs ? binned.lastTs.toISOString() : null,
      license_type: catalogRow.license_type,
      citation: catalogRow.citation,
    }, { onConflict: 'study_id,geo_hash,local_tz,window_start,window_end' });
}

type ProcessOutcome = { status: 'done' | 'dead'; reason?: string };

async function processJob(job: CollarJob): Promise<ProcessOutcome> {
  const scientificNames = scientificNamesForSpeciesTaxonKey(job.species_taxon_key);
  if (scientificNames.length === 0) return { status: 'dead', reason: 'unknown_species_taxon_key' };

  const catalogRow = await getCatalogRow(job.study_id);
  if (!catalogRow) return { status: 'dead', reason: 'study_not_in_catalog' };
  if (!catalogRow.license_type || !isCommercialSafeLicense(catalogRow.license_type)) {
    return { status: 'dead', reason: 'license_not_eligible' };
  }

  await ensureLicenseRecordedForStudy(String(job.study_id));

  const windowStart = new Date(job.window_start);
  const windowEnd = new Date(job.window_end);

  const fetchResult = await fetchMovebankEventsForWindow(
    String(job.study_id), windowStart, windowEnd, catalogRow.license_type, true
  );

  if (fetchResult.handshake === 'aborted_noncommercial') {
    return { status: 'dead', reason: 'license_rejected' };
  }

  if (fetchResult.truncated) {
    if (job.split_depth >= MAX_SPLIT_DEPTH) return { status: 'dead', reason: 'truncated_at_max_split' };
    const halves = splitWindowInHalf({ start: windowStart, end: windowEnd });
    await enqueueSplitJobs(job, halves);
    return { status: 'done' }; // parent is done-with-split — no aggregate written for it
  }

  const speciesFilter = await filterEventsBySpeciesForJob(
    String(job.study_id), catalogRow.taxon_ids ?? '', fetchResult.events, scientificNames, catalogRow.license_type
  );
  if (speciesFilter.outcome === 'dead') return { status: 'dead', reason: speciesFilter.reason };

  const { lat: objLat, lon: objLon } = decodeGeohash(job.geo_hash);
  const geoFiltered = speciesFilter.events.filter(e => haversineKm(objLat, objLon, e.lat, e.lon) <= EVENT_RADIUS_KM);

  const binned = binEventsForAggregate(geoFiltered, job.local_tz);
  const elevSamples = await sampleElevations(geoFiltered);

  await writeAggregate(job, catalogRow, binned, elevSamples);
  return { status: 'done' };
}

async function finalizeJob(jobId: string, outcome: ProcessOutcome): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('collar_jobs')
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      locked_until: null,
      last_error: outcome.status === 'dead' ? (outcome.reason ?? 'dead') : null,
    })
    .eq('id', jobId);
}

async function handleJobFailure(job: CollarJob, err: unknown): Promise<void> {
  const kind = classifyMovebankError(err);
  const supabase = createServiceClient();

  if (kind !== 'other') {
    await registerMovebankFailure(kind);
  }

  const shortReason = kind === 'other'
    ? `error: ${err instanceof Error ? err.message.slice(0, 180) : 'unknown error'}`
    : `movebank_${kind}`;

  if (job.attempts >= job.max_attempts) {
    await supabase
      .from('collar_jobs')
      .update({ status: 'dead', finished_at: new Date().toISOString(), locked_until: null, last_error: shortReason })
      .eq('id', job.id);
    return;
  }

  const backoffIndex = Math.min(Math.max(0, job.attempts - 1), RETRY_BACKOFF_MINUTES.length - 1);
  const runAfter = new Date(Date.now() + RETRY_BACKOFF_MINUTES[backoffIndex] * 60000).toISOString();

  await supabase
    .from('collar_jobs')
    .update({ status: 'queued', locked_until: null, run_after: runAfter, last_error: shortReason })
    .eq('id', job.id);
}

export type JobRunResult = { ran: boolean; jobId?: string; status?: 'done' | 'dead' | 'failed'; reason?: string };

// One invocation = requeue any stale `running` jobs, then claim and process
// exactly one job. The caller (the cron route) holds the movebank_lease for
// the whole call and always releases it in a finally.
export async function runOneJob(): Promise<JobRunResult> {
  await requeueStaleJobs();

  const job = await claimJob();
  if (!job) return { ran: false };

  try {
    const outcome = await processJob(job);
    await finalizeJob(job.id, outcome);
    return { ran: true, jobId: job.id, status: outcome.status, reason: outcome.reason };
  } catch (err) {
    await handleJobFailure(job, err);
    return { ran: true, jobId: job.id, status: 'failed', reason: err instanceof Error ? err.message : 'unknown error' };
  }
}
