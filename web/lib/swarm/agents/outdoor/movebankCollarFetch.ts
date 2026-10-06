// FF-093 — Movebank GPS Collar Data Fetch
// Config layer: species taxon mapping + raw study/event retrieval against the
// Movebank REST API (HTTP Basic Auth, free registration, ~1 req/sec limit).
//
// Verified against https://github.com/movebank/movebank-api-doc/blob/master/movebank-api.md
// (2026-09-29/30). Corrections vs. the original FF-093 spec, which assumed
// facts about the API that don't hold:
//   1. `taxon_ids` is a STUDY OUTPUT ATTRIBUTE, not a request filter — and its
//      values are ITIS scientific names (e.g. "Cervus canadensis"), not
//      numeric IDs. There is no server-side "give me elk studies" call;
//      studies must be fetched broadly and matched client-side by name.
//   2. `number_of_deployed_individuals` is not a real attribute — the
//      documented field is `number_of_individuals`.
//   3. Non-CC0 studies don't return data on the first request at all: the
//      response is HTML license text with header `accept-license: true`.
//      The caller must md5 that text and retry with `license-md5=<hash>`,
//      carrying the session cookie from the first response (see
//      movebankRequest() below).
// Movebank taxon IDs from the original spec were therefore fabricated and
// have been replaced with ITIS canonical names below.

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

// species_taxon_key -> ITIS canonical scientific name(s), matched against a
// study's taxon_ids attribute (comma-separated list of names). A species can
// have more than one acceptable name — the live catalog tags elk studies as
// "Cervus elaphus" (the Old-World name Movebank's taxonomy actually uses),
// not just "Cervus canadensis" as originally assumed, so both must match.
// Salmon removed (FF-093 fix tasker item 8): salmon are not GPS-collared,
// and this agent's domain is elk_hunt — including fish taxa here risked
// cross-contaminating the fishing-domain agent isolation.
export const MOVEBANK_TAXON_NAMES: Record<string, string[]> = {
  elk: ['Cervus elaphus', 'Cervus canadensis'],
  deer_mule: ['Odocoileus hemionus'],
  deer_whitetail: ['Odocoileus virginianus'],
  moose: ['Alces alces'],
  caribou: ['Rangifer tarandus'],
  pronghorn: ['Antilocapra americana'],
};

// True if a study's raw taxon_ids cell contains ANY of the given scientific
// names (case-insensitive, exact segment match — taxon_ids is a
// comma-joined list of names, not a free-text field to substring-search).
export function taxonMatchesAny(taxonIdsRaw: string, scientificNames: string[]): boolean {
  const segments = taxonIdsRaw.split(',').map(s => s.trim().toLowerCase());
  return scientificNames.some(name => segments.includes(name.toLowerCase()));
}

// Maps a taxonomy_key (e.g. 'elk.bull.archery', 'deer.mule.archery') to the
// Movebank scientific name(s) that identify it + the normalized
// species_taxon_key used as the collar_pattern_library routing key. Single
// source of truth — both the extractor (write path) and calibration (read
// path) call this. speciesTaxonKey is unaffected by a species having
// multiple acceptable Movebank names — it's still one routing key per
// species regardless of how many taxon_ids strings can match it.
export function resolveMovebankTaxon(taxonomyKey: string): { scientificNames: string[]; speciesTaxonKey: string } | null {
  const parts = taxonomyKey.split('.');
  const root = parts[0];
  const sub = parts[1];

  if (root === 'elk') return { scientificNames: MOVEBANK_TAXON_NAMES.elk, speciesTaxonKey: `elk.${sub ?? 'unspecified'}` };
  if (root === 'deer' && sub === 'mule') return { scientificNames: MOVEBANK_TAXON_NAMES.deer_mule, speciesTaxonKey: 'deer.mule' };
  if (root === 'deer' && sub === 'whitetail') return { scientificNames: MOVEBANK_TAXON_NAMES.deer_whitetail, speciesTaxonKey: 'deer.whitetail' };
  if (root === 'moose') return { scientificNames: MOVEBANK_TAXON_NAMES.moose, speciesTaxonKey: 'moose' };
  if (root === 'caribou') return { scientificNames: MOVEBANK_TAXON_NAMES.caribou, speciesTaxonKey: 'caribou' };
  if (root === 'pronghorn') return { scientificNames: MOVEBANK_TAXON_NAMES.pronghorn, speciesTaxonKey: 'pronghorn' };

  return null;
}

// Reverse of resolveMovebankTaxon's speciesTaxonKey — Phase 2 jobs store
// only species_taxon_key (already resolved once by the planner), so the
// worker needs to get back to scientificNames without the original full
// taxonomy_key. Matches resolveMovebankTaxon's exact branching so the two
// can never disagree about what a given key means.
export function scientificNamesForSpeciesTaxonKey(speciesTaxonKey: string): string[] {
  const root = speciesTaxonKey.split('.')[0];

  if (root === 'elk') return MOVEBANK_TAXON_NAMES.elk;
  if (speciesTaxonKey === 'deer.mule') return MOVEBANK_TAXON_NAMES.deer_mule;
  if (speciesTaxonKey === 'deer.whitetail') return MOVEBANK_TAXON_NAMES.deer_whitetail;
  if (root === 'moose') return MOVEBANK_TAXON_NAMES.moose;
  if (root === 'caribou') return MOVEBANK_TAXON_NAMES.caribou;
  if (root === 'pronghorn') return MOVEBANK_TAXON_NAMES.pronghorn;

  return [];
}

export function hasMovebankCredentials(): boolean {
  return !!process.env.MOVEBANK_USERNAME && !!process.env.MOVEBANK_PASSWORD;
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.MOVEBANK_USERNAME}:${process.env.MOVEBANK_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

// Confirmed CC_0 via a live doc example ("license_type shows CC_0"). CC_BY is
// included by Creative-Commons-naming-convention inference, NOT confirmed
// against a real API response — flagged in the PR description. Everything
// else (non-commercial, custom terms, unlicensed, ND/SA variants) is
// excluded until Todd Reese reviews Movebank's data-use terms for a
// commercial product.
export const COMMERCIAL_SAFE_LICENSES = ['CC_0', 'CC_BY'];

// Movebank's real license_type spelling is unconfirmed beyond the one CC_0
// example in the docs (could be "CC-BY", "cc_by", "CC BY", etc.) — normalize
// before comparing so any of those match, while NC/ND/SA variants
// (CC_BY_NC, CC_BY_ND, CC_BY_SA, CC_BY_NC_SA, ...) correctly do NOT.
export function normalizeLicenseType(raw: string): string {
  return raw.toUpperCase().trim().replace(/[-\s]+/g, '_');
}

export function isCommercialSafeLicense(rawLicenseType: string): boolean {
  return COMMERCIAL_SAFE_LICENSES.includes(normalizeLicenseType(rawLicenseType));
}

// --- RFC 4180 CSV parsing (handles quoted fields, escaped "" quotes, and
// commas/newlines embedded inside quoted cells — Movebank's own multi-value
// attributes like taxon_ids and sensor_type_ids are comma-joined WITHIN a
// single cell, which a naive split(',') corrupts whenever a study name or
// citation also contains a comma). ---
export function parseCsv(text: string, maxRows: number): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      if (rows.length >= maxRows + 1) break; // +1 for header
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = (cells[i] ?? '').trim(); });
    return r;
  });
}

// Movebank returns a plain-text message (not a distinct HTTP status per the
// docs) when the account lacks access to a study's data.
function isAccessDenied(text: string): boolean {
  return text.toLowerCase().includes('no data available');
}

const RATE_LIMIT_DELAY_MS = 1100;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20MB hard cap on a data response
const MAX_LICENSE_BYTES = 1 * 1024 * 1024;   // license text is small — 1MB is generous

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Movebank allows exactly one concurrent request per IP/account. Every real
// HTTP call in this module goes through movebankRequest(), and this queue
// serializes them so nothing ever overlaps, regardless of caller.
let requestQueue: Promise<void> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(fn, fn);
  requestQueue = run.then(() => undefined, () => undefined);
  return run;
}

type CappedRead = { bytes: Uint8Array; totalBytes: number; truncated: boolean };

// Reads a response body up to maxBytes, returning the raw bytes (never a
// re-encoded string) so callers that need to hash the exact payload
// (the license-md5 handshake) get a byte-for-byte match. Also reports the
// true total size seen and whether the cap cut anything off, for diagnostics
// (the admin probe route).
async function readBodyCapped(response: Response, maxBytes: number): Promise<CappedRead> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    const truncated = buf.length > maxBytes;
    return { bytes: truncated ? buf.slice(0, maxBytes) : buf, totalBytes: buf.length, truncated };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { truncated = true; await reader.cancel(); break; }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= out.length) break;
    const slice = chunk.subarray(0, out.length - offset);
    out.set(slice, offset);
    offset += slice.length;
  }
  return { bytes: out, totalBytes: total, truncated };
}

// Every Set-Cookie value's `name=value` pair, joined for a Cookie header.
// Node's fetch (undici) doesn't persist cookies across requests, so this is
// carried manually on the license-accepted retry.
function extractCookieHeader(headers: Headers): string | null {
  type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };
  const h = headers as HeadersWithSetCookie;
  const values = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  const setCookies = values.length > 0 ? values : (headers.get('set-cookie') ? [headers.get('set-cookie') as string] : []);
  if (setCookies.length === 0) return null;
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

async function rawFetch(url: string, cookie: string | null, timeoutMs: number): Promise<Response> {
  await sleep(RATE_LIMIT_DELAY_MS);
  const headers: Record<string, string> = { Authorization: authHeader() };
  if (cookie) headers.Cookie = cookie;
  // Never log `headers` or any derivative of it — it carries Authorization/Cookie.
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
}

export type MovebankHandshakeResult = 'not_required' | 'accepted' | 'rejected_by_server' | 'aborted_noncommercial';

async function recordLicenseAcceptance(studyId: string, licenseType: string | undefined, licenseMd5: string, licenseText: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    // "on conflict do nothing" — Movebank requires the handshake once per
    // session regardless, but the audit row only needs to exist once per
    // (study, md5).
    await supabase
      .from('movebank_license_acceptances')
      .upsert(
        { study_id: Number(studyId), license_type: licenseType ?? null, license_md5: licenseMd5, license_text: licenseText },
        { onConflict: 'study_id,license_md5', ignoreDuplicates: true }
      );
  } catch (err) {
    console.error(`[movebank] failed to record license acceptance for study ${studyId}:`, err instanceof Error ? err.message : err);
  }
}

// The single choke point for all real Movebank HTTP calls: rate limiting,
// serialization, and the license-terms handshake all live here. `context`
// (studyId/licenseType) is provided for event fetches so an accepted
// handshake can be recorded; omitted for the study-catalog call, which
// isn't scoped to one study. `context.record` (defaults true) gates the
// actual database write — the admin probe route passes `record: false` so a
// diagnostic run performs the handshake (Movebank requires it regardless)
// without ever writing to movebank_license_acceptances.
type MovebankRequestResult = { text: string; handshake: MovebankHandshakeResult; responseBytes: number; truncated: boolean };

async function movebankRequest(
  url: string,
  maxDataBytes: number,
  context?: { studyId: string; licenseType?: string; record?: boolean }
): Promise<MovebankRequestResult> {
  return serialize(async () => {
    const first = await rawFetch(url, null, 30000);
    if (!first.ok) throw new Error(`Movebank HTTP ${first.status}`);

    if (first.headers.get('accept-license') !== 'true') {
      const { bytes, totalBytes, truncated } = await readBodyCapped(first, maxDataBytes);
      return { text: new TextDecoder().decode(bytes), handshake: 'not_required' as const, responseBytes: totalBytes, truncated };
    }

    // License handshake required — read the license text (capped, small),
    // never the full data cap.
    const { bytes: licenseBytes } = await readBodyCapped(first, MAX_LICENSE_BYTES);
    const licenseText = new TextDecoder().decode(licenseBytes);

    if (/non-?commercial/i.test(licenseText)) {
      if (context) console.warn(`[movebank] study ${context.studyId} license text mentions NonCommercial — aborting use despite license_type='${context.licenseType ?? 'unknown'}'`);
      return { text: '', handshake: 'aborted_noncommercial' as const, responseBytes: 0, truncated: false };
    }

    // Hash the exact bytes received, not a re-encoded string.
    const licenseMd5 = createHash('md5').update(Buffer.from(licenseBytes)).digest('hex');
    const cookie = extractCookieHeader(first.headers);

    const retryUrl = `${url}&license-md5=${licenseMd5}`;
    const second = await rawFetch(retryUrl, cookie, 30000);
    if (!second.ok) throw new Error(`Movebank HTTP ${second.status}`);

    if (second.headers.get('accept-license') === 'true') {
      throw new Error('license handshake rejected');
    }

    if (context && context.record !== false) {
      await recordLicenseAcceptance(context.studyId, context.licenseType, licenseMd5, licenseText);
    }

    const { bytes: dataBytes, totalBytes, truncated } = await readBodyCapped(second, maxDataBytes);
    return { text: new TextDecoder().decode(dataBytes), handshake: 'accepted' as const, responseBytes: totalBytes, truncated };
  });
}

export type MovebankStudy = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  numberOfIndividuals: number;
  taxonIds: string; // raw comma-joined scientific names, as returned
  licenseType: string;
  citation: string;
  hasDownloadAccess: boolean;
  timestampFirstDeployedLocation: string; // raw Movebank string — Phase 2 job planning intersects windows against these
  timestampLastDeployedLocation: string;
};

const MAX_STUDY_ROWS = 20000;

export type MovebankStudyFetchResult = {
  studies: MovebankStudy[];                    // coordinate-valid — same set fetchMovebankStudies() returns
  rawRows: Array<Record<string, string>>;       // every parsed CSV row, unfiltered — for probe/diagnostic use
  rawRowCount: number;                          // rawRows.length, before the coordinate filter
  responseBytes: number;
  truncated: boolean;                           // true if the 20MB response cap or the row cap cut the list
};

// Single source of truth for the study catalog query, so the admin probe
// can report the exact parameter NAMES used (addendum 4 item 4 — catalog
// determinism) without a second, driftable copy of this list.
const STUDY_QUERY_PARAMS: Record<string, string> = {
  entity_type: 'study',
  i_have_download_access: 'true',
  // timestamp_first/last_deployed_location added for Phase 2 (batch 1 item
  // 3) — confirmed real study attributes (same result header as the rest of
  // this list) — so the job planner can intersect a hunt-season window
  // against each study's actual date range without a second per-study call.
  attributes: 'id,name,main_location_lat,main_location_long,number_of_individuals,taxon_ids,license_type,citation,i_have_download_access,timestamp_first_deployed_location,timestamp_last_deployed_location',
};
export const STUDY_QUERY_PARAM_NAMES = Object.keys(STUDY_QUERY_PARAMS);

// Builds "k1=v1&k2=v2" without URL-encoding values — Movebank's own doc
// examples use literal unencoded commas in `attributes` lists, and there's
// no live way to confirm %2C-encoded commas behave identically, so this
// preserves the exact working format rather than switching to
// URLSearchParams (which would percent-encode them).
function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
}

// Movebank has no server-side taxon or geographic filter for study
// discovery (see file header) — this fetches every study the account can
// see download access to, and the caller filters by species name, distance,
// and license client-side. `i_have_download_access=true` is a real
// documented query parameter and meaningfully narrows the result set.
export async function fetchMovebankStudiesDetailed(): Promise<MovebankStudyFetchResult> {
  const url = 'https://www.movebank.org/movebank/service/direct-read?' + buildQueryString(STUDY_QUERY_PARAMS);

  const { text, responseBytes, truncated: byteTruncated } = await movebankRequest(url, MAX_RESPONSE_BYTES);
  const rawRows = parseCsv(text, MAX_STUDY_ROWS);
  // parseCsv stops accepting rows once it hits maxRows — if it returned
  // exactly that many, the source almost certainly had more (or, rarely,
  // had exactly that many; documented approximation).
  const rowTruncated = rawRows.length >= MAX_STUDY_ROWS;

  const studies = rawRows
    .filter(r => r.id)
    .map(r => ({
      id: r.id,
      name: r.name ?? '',
      lat: r.main_location_lat ? parseFloat(r.main_location_lat) : null,
      lon: r.main_location_long ? parseFloat(r.main_location_long) : null,
      numberOfIndividuals: parseInt(r.number_of_individuals ?? '0', 10) || 0,
      taxonIds: r.taxon_ids ?? '',
      licenseType: r.license_type ?? '',
      citation: r.citation ?? '',
      hasDownloadAccess: (r.i_have_download_access ?? '').toLowerCase() === 'true',
      timestampFirstDeployedLocation: r.timestamp_first_deployed_location ?? '',
      timestampLastDeployedLocation: r.timestamp_last_deployed_location ?? '',
    }))
    .filter(s => s.lat !== null && !isNaN(s.lat) && s.lon !== null && !isNaN(s.lon));

  return { studies, rawRows, rawRowCount: rawRows.length, responseBytes, truncated: byteTruncated || rowTruncated };
}

export async function fetchMovebankStudies(): Promise<MovebankStudy[]> {
  const { studies } = await fetchMovebankStudiesDetailed();
  return studies;
}

export type MovebankEvent = {
  individualId: string;
  timestamp: string;
  lat: number;
  lon: number;
};

// Movebank returns timestamps as "2008-05-31 13:30:02.001" — a space-
// separated, non-ISO format with no timezone marker. Per spec, `new
// Date(...)` on that exact string is implementation-defined (V8 happens to
// treat it as local time), so it's converted to a real ISO/UTC string
// explicitly rather than relying on that behavior. Movebank GPS timestamps
// are UTC.
export function parseMovebankTimestamp(ts: string): Date {
  return new Date(`${ts.replace(' ', 'T')}Z`);
}

const MAX_EVENT_ROWS = 250000;
const YEARS_OF_HISTORY = 5;
const GPS_SENSOR_TYPE_ID = 653; // confirmed: Movebank's numeric id for GPS sensors

function movebankTimestampParam(date: Date): string {
  // yyyyMMddHHmmssSSS, per the documented timestamp_start/timestamp_end format
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    pad(date.getUTCMilliseconds(), 3)
  );
}

export type MovebankEventFetchResult = {
  events: MovebankEvent[];
  handshake: MovebankHandshakeResult;
  truncated: boolean; // true if the byte cap or the row cap cut the response short — see collarPatternExtractor's truncation-safety check
};

// Rich variant used by the admin probe route to report what actually
// happened (handshake required? accepted? aborted?) without exposing raw
// events. fetchMovebankEvents() below is the plain production-facing form.
// `record` (defaults true, matching prior behavior for the production
// extractor) gates whether an accepted handshake is written to
// movebank_license_acceptances — the probe route passes `record: false` by
// default so a diagnostic run makes zero database writes.
export async function fetchMovebankEventsDetailed(studyId: string, licenseType?: string, record: boolean = true): Promise<MovebankEventFetchResult> {
  const timestampStart = movebankTimestampParam(new Date(Date.now() - YEARS_OF_HISTORY * 365 * 86400000));
  const url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=event&study_id=${studyId}&sensor_type_id=${GPS_SENSOR_TYPE_ID}`
    + `&timestamp_start=${timestampStart}`
    + '&attributes=individual_id,timestamp,location_lat,location_long';

  const { text, handshake, truncated: byteTruncated } = await movebankRequest(url, MAX_RESPONSE_BYTES, { studyId, licenseType, record });

  if (handshake === 'aborted_noncommercial' || isAccessDenied(text)) {
    return { events: [], handshake, truncated: false };
  }

  const rows = parseCsv(text, MAX_EVENT_ROWS);
  const rowTruncated = rows.length >= MAX_EVENT_ROWS;
  const events: MovebankEvent[] = [];
  for (const r of rows) {
    const lat = parseFloat(r.location_lat ?? r['location-lat']);
    const lon = parseFloat(r.location_long ?? r['location-long']);
    if (!r.timestamp || isNaN(lat) || isNaN(lon)) continue;
    events.push({ individualId: r.individual_id ?? r['individual-id'] ?? '', timestamp: r.timestamp, lat, lon });
  }
  return { events, handshake, truncated: byteTruncated || rowTruncated };
}

export async function fetchMovebankEvents(studyId: string, licenseType?: string): Promise<MovebankEvent[]> {
  const { events } = await fetchMovebankEventsDetailed(studyId, licenseType);
  return events;
}

// --- Windowed event fetch for Phase 2 jobs (spec v2 amendments A1/A2/A3) ---
// A1: time bounds come from the job's own (window_start, window_end), never
// a fixed lookback — the original fetchMovebankEventsDetailed() above still
// uses YEARS_OF_HISTORY and stays untouched for the Phase 1 production
// extractor; this is a separate function for the job runner.
// A2: requests `individual_taxon_canonical_name` directly as an EVENT
// attribute (confirmed in the docs' own result-header example:
// "individual_local_identifier,tag_local_identifier,timestamp,location_long,
// location_lat,visible,individual_taxon_canonical_name") so species can be
// filtered per-fix without a separate individuals join in the common case.
export type MovebankEventWithTaxon = MovebankEvent & { taxonCanonicalName: string };

export type MovebankWindowedEventResult = {
  events: MovebankEventWithTaxon[];
  handshake: MovebankHandshakeResult;
  truncated: boolean;
};

export async function fetchMovebankEventsForWindow(
  studyId: string,
  windowStart: Date,
  windowEnd: Date,
  licenseType?: string,
  record: boolean = true,
  sensorFilter: boolean = true // fix round item 3 — the admin probe needs to test with the GPS sensor filter OFF; every real production call keeps the default (true)
): Promise<MovebankWindowedEventResult> {
  let url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=event&study_id=${studyId}`;
  if (sensorFilter) url += `&sensor_type_id=${GPS_SENSOR_TYPE_ID}`;
  url += `&timestamp_start=${movebankTimestampParam(windowStart)}`
    + `&timestamp_end=${movebankTimestampParam(windowEnd)}`
    + '&attributes=individual_id,timestamp,location_lat,location_long,individual_taxon_canonical_name';

  const { text, handshake, truncated: byteTruncated } = await movebankRequest(url, MAX_RESPONSE_BYTES, { studyId, licenseType, record });

  if (handshake === 'aborted_noncommercial' || isAccessDenied(text)) {
    return { events: [], handshake, truncated: false };
  }

  const rows = parseCsv(text, MAX_EVENT_ROWS);
  const rowTruncated = rows.length >= MAX_EVENT_ROWS;
  const events: MovebankEventWithTaxon[] = [];
  for (const r of rows) {
    const lat = parseFloat(r.location_lat ?? r['location-lat']);
    const lon = parseFloat(r.location_long ?? r['location-long']);
    if (!r.timestamp || isNaN(lat) || isNaN(lon)) continue;
    events.push({
      individualId: r.individual_id ?? r['individual-id'] ?? '',
      timestamp: r.timestamp,
      lat,
      lon,
      taxonCanonicalName: r.individual_taxon_canonical_name ?? '',
    });
  }
  return { events, handshake, truncated: byteTruncated || rowTruncated };
}

// Exposed so the job runner can format its own window boundaries the same
// way without re-deriving the yyyyMMddHHmmssSSS format.
export function formatMovebankTimestamp(date: Date): string {
  return movebankTimestampParam(date);
}

// --- Individuals (addendum 4 item 2 — multi-species study filtering) ---
// A study can carry several species; without this, events from a
// completely different animal were being binned into the requested
// species' pattern. `individual_taxon_canonical_name` is the confirmed
// result-header attribute name for entity_type=individual (NOT
// "taxon_canonical_name" — that was an unverified guess). The join key
// back to an event is individual.id == event.individual_id (confirmed in
// the docs); local_identifier is a separate human-readable tag, not the
// join key.
export type MovebankIndividual = {
  id: string;
  localIdentifier: string;
  taxonCanonicalName: string;
};

export async function fetchMovebankIndividuals(studyId: string, licenseType?: string): Promise<MovebankIndividual[]> {
  const url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=individual&study_id=${studyId}`
    + '&attributes=id,local_identifier,individual_taxon_canonical_name';

  // Metadata, not tracking data — routed through the same choke point for
  // rate-limiting/serialization, but never itself recorded as a license
  // acceptance (the event fetch for this study already records that).
  const { text } = await movebankRequest(url, MAX_RESPONSE_BYTES, { studyId, licenseType, record: false });
  if (isAccessDenied(text)) return [];

  const rows = parseCsv(text, MAX_EVENT_ROWS);
  return rows
    .filter(r => r.id)
    .map(r => ({
      id: r.id,
      localIdentifier: r.local_identifier ?? '',
      taxonCanonicalName: r.individual_taxon_canonical_name ?? '',
    }));
}

// --- Study metadata for zero-row diagnosis (addendum 4 item 1) ---
// No names, owner, or citation — just the attributes needed to tell
// whether a study's data window/sensors/individual count line up with why
// an event fetch might have returned zero rows.
export type MovebankStudyMeta = {
  timestampFirstDeployedLocation: string;
  timestampLastDeployedLocation: string;
  numberOfDeployedLocations: string;
  sensorTypeIds: string;
  taxonIds: string;
  numberOfIndividuals: string;
  licenseTerms: string; // Phase 2 A5 — the actual license TEXT (not license_type), confirmed real study attribute
};

// Single source of truth for the study-meta attribute list, so the fix-round
// bisect probe (probeStudyAttribute, below) tests exactly the attributes
// fetchMovebankStudyMeta actually requests — not a second, driftable copy.
export const STUDY_META_ATTRIBUTES = [
  'timestamp_first_deployed_location',
  'timestamp_last_deployed_location',
  'number_of_deployed_locations',
  'sensor_type_ids',
  'taxon_ids',
  'number_of_individuals',
  'license_terms',
];

export async function fetchMovebankStudyMeta(studyId: string): Promise<MovebankStudyMeta | null> {
  const url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=study&study_id=${studyId}`
    + `&attributes=${STUDY_META_ATTRIBUTES.join(',')}`;

  const { text } = await movebankRequest(url, MAX_RESPONSE_BYTES);
  const rows = parseCsv(text, 10);
  const r = rows[0];
  if (!r) return null;

  return {
    timestampFirstDeployedLocation: r.timestamp_first_deployed_location ?? '',
    timestampLastDeployedLocation: r.timestamp_last_deployed_location ?? '',
    numberOfDeployedLocations: r.number_of_deployed_locations ?? '',
    sensorTypeIds: r.sensor_type_ids ?? '',
    taxonIds: r.taxon_ids ?? '',
    numberOfIndividuals: r.number_of_individuals ?? '',
    licenseTerms: r.license_terms ?? '',
  };
}

// --- Event-fetch variants for zero-row diagnosis (addendum 4 item 1) ---
// Isolates which of {time window, sensor filter, access, attribute naming}
// caused a zero-row response, WITHOUT ever returning rows, names, or
// license text — only counts and the header's column NAMES.
export type MovebankEventVariantResult = {
  http_ok: boolean;
  response_bytes: number;
  truncated: boolean;
  data_line_count: number;
  access_denied_message: boolean;
  header_columns: string[];
  handshake: MovebankHandshakeResult | 'error';
  elapsed_ms: number;
  error?: string;
};

export type MovebankEventVariantOptions = {
  sensorFilter: boolean;
  timestampStart: boolean;
  individualLocalIdentifier?: string; // per the docs, events filter by individual_local_identifier, not individual_id
  maxBytes: number;
};

export async function fetchMovebankEventsVariant(
  studyId: string,
  opts: MovebankEventVariantOptions,
  licenseType?: string
): Promise<MovebankEventVariantResult> {
  const start = Date.now();
  let url = 'https://www.movebank.org/movebank/service/direct-read?entity_type=event' + `&study_id=${studyId}`;
  if (opts.sensorFilter) url += `&sensor_type_id=${GPS_SENSOR_TYPE_ID}`;
  if (opts.timestampStart) url += `&timestamp_start=${movebankTimestampParam(new Date(Date.now() - YEARS_OF_HISTORY * 365 * 86400000))}`;
  if (opts.individualLocalIdentifier) url += `&individual_local_identifier=${encodeURIComponent(opts.individualLocalIdentifier)}`;
  url += '&attributes=individual_id,timestamp,location_lat,location_long';

  try {
    // record: false — this is a diagnostic probe of response shape, not a
    // real data pull; the main event fetch for this study (if any) is what
    // gets recorded.
    const { text, handshake, responseBytes, truncated } = await movebankRequest(url, opts.maxBytes, { studyId, licenseType, record: false });

    if (handshake === 'aborted_noncommercial') {
      return { http_ok: true, response_bytes: responseBytes, truncated, data_line_count: 0, access_denied_message: false, header_columns: [], handshake, elapsed_ms: Date.now() - start };
    }

    const lines = text.split('\n').filter(l => l.length > 0);
    const headerColumns = lines.length > 0 ? lines[0].split(',').map(c => c.trim()) : [];
    const dataLineCount = Math.max(0, lines.length - 1);

    return {
      http_ok: true,
      response_bytes: responseBytes,
      truncated,
      data_line_count: dataLineCount,
      access_denied_message: isAccessDenied(text),
      header_columns: headerColumns,
      handshake,
      elapsed_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      http_ok: false,
      response_bytes: 0,
      truncated: false,
      data_line_count: 0,
      access_denied_message: false,
      header_columns: [],
      handshake: 'error',
      elapsed_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

// --- Single-attribute study probe (fix round item 3 — "bisect" diagnostics) ---
// Isolates whether ONE study attribute name is usable by a live account,
// reporting only the HTTP status CLASS (2xx/4xx/5xx) — never the response
// body, so no license text or data ever surfaces through this path. Goes
// through the same movebankRequest choke point as every other call in this
// module, so it automatically inherits the real rate limit + single-flight
// serialization ("the normal spacing") — no separate throttling needed here.
export type StudyAttributeProbeResult = {
  ok: boolean;
  http_status_class: '2xx' | '4xx' | '5xx' | 'error';
  elapsed_ms: number;
};

// Request-SHAPE knobs for a single-study query (fix round #2 —
// "bisect=study_meta_params"). The attribute-name bisection above
// (probeStudyAttribute with no `shape`) keeps the request shape fixed at
// `entity_type=study&study_id=X`; this instead varies the shape itself:
// whether `i_have_download_access=true` is present (the one param the
// catalog discovery query uses that no single-entity call does) and
// whether the study is scoped via `id=X` instead of `study_id=X`.
export type StudyParamShape = {
  idParam: 'study_id' | 'id';
  includeDownloadAccess: boolean;
};

export const STUDY_PARAM_SHAPES: Record<'A' | 'B' | 'C', StudyParamShape> = {
  A: { idParam: 'study_id', includeDownloadAccess: true },
  B: { idParam: 'id', includeDownloadAccess: false },
  C: { idParam: 'id', includeDownloadAccess: true },
};

// `shape` is optional so every existing caller (the attribute-name
// bisection, which never passes one) keeps the exact original request:
// `entity_type=study&study_id=X&attributes=...`, with no
// `i_have_download_access` param.
export async function probeStudyAttribute(studyId: string, attributes: string, shape?: StudyParamShape): Promise<StudyAttributeProbeResult> {
  const start = Date.now();
  const idParam = shape?.idParam ?? 'study_id';
  let url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=study&${idParam}=${studyId}`;
  if (shape?.includeDownloadAccess) url += '&i_have_download_access=true';
  url += `&attributes=${attributes}`;
  try {
    // No `context` passed — a study-attribute probe is metadata, never
    // recorded as a license acceptance (matches fetchMovebankStudyMeta).
    await movebankRequest(url, MAX_RESPONSE_BYTES);
    return { ok: true, http_status_class: '2xx', elapsed_ms: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const match = /Movebank HTTP ([45])\d\d/.exec(message);
    return {
      ok: false,
      http_status_class: match ? (`${match[1]}xx` as '4xx' | '5xx') : 'error',
      elapsed_ms: Date.now() - start,
    };
  }
}
