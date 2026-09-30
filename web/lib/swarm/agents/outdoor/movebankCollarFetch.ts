// FF-093 — Movebank GPS Collar Data Fetch
// Config layer: species taxon mapping + raw study/event retrieval against the
// Movebank REST API (HTTP Basic Auth, free registration, ~1 req/sec limit).
//
// Verified against https://github.com/movebank/movebank-api-doc/blob/master/movebank-api.md
// (2026-09-29). Two corrections vs. the original FF-093 spec, which assumed
// facts about the API that don't hold:
//   1. `taxon_ids` is a STUDY OUTPUT ATTRIBUTE, not a request filter — and its
//      values are ITIS scientific names (e.g. "Cervus canadensis"), not
//      numeric IDs. There is no server-side "give me elk studies" call;
//      studies must be fetched broadly and matched client-side by name.
//   2. `number_of_deployed_individuals` is not a real attribute — the
//      documented field is `number_of_individuals`.
// Movebank taxon IDs from the original spec were therefore fabricated and
// have been replaced with ITIS canonical names below.

// species_taxon_key -> ITIS canonical scientific name, matched as a substring
// against a study's taxon_ids attribute (comma-separated list of names).
// Salmon removed (FF-093 fix tasker item 8): salmon are not GPS-collared,
// and this agent's domain is elk_hunt — including fish taxa here risked
// cross-contaminating the fishing-domain agent isolation.
export const MOVEBANK_TAXON_NAMES: Record<string, string> = {
  elk: 'Cervus canadensis',
  deer_mule: 'Odocoileus hemionus',
  deer_whitetail: 'Odocoileus virginianus',
  moose: 'Alces alces',
  caribou: 'Rangifer tarandus',
  pronghorn: 'Antilocapra americana',
};

// Maps a taxonomy_key (e.g. 'elk.bull.archery', 'deer.mule.archery') to a
// Movebank scientific name + the normalized species_taxon_key used as the
// collar_pattern_library routing key. Single source of truth — both the
// extractor (write path) and calibration (read path) call this.
export function resolveMovebankTaxon(taxonomyKey: string): { scientificName: string; speciesTaxonKey: string } | null {
  const parts = taxonomyKey.split('.');
  const root = parts[0];
  const sub = parts[1];

  if (root === 'elk') return { scientificName: MOVEBANK_TAXON_NAMES.elk, speciesTaxonKey: `elk.${sub ?? 'unspecified'}` };
  if (root === 'deer' && sub === 'mule') return { scientificName: MOVEBANK_TAXON_NAMES.deer_mule, speciesTaxonKey: 'deer.mule' };
  if (root === 'deer' && sub === 'whitetail') return { scientificName: MOVEBANK_TAXON_NAMES.deer_whitetail, speciesTaxonKey: 'deer.whitetail' };
  if (root === 'moose') return { scientificName: MOVEBANK_TAXON_NAMES.moose, speciesTaxonKey: 'moose' };
  if (root === 'caribou') return { scientificName: MOVEBANK_TAXON_NAMES.caribou, speciesTaxonKey: 'caribou' };
  if (root === 'pronghorn') return { scientificName: MOVEBANK_TAXON_NAMES.pronghorn, speciesTaxonKey: 'pronghorn' };

  return null;
}

export function hasMovebankCredentials(): boolean {
  return !!process.env.MOVEBANK_USERNAME && !!process.env.MOVEBANK_PASSWORD;
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.MOVEBANK_USERNAME}:${process.env.MOVEBANK_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

// Confirmed CC0 via a live doc example ("license_type shows CC_0"). CC_BY is
// included by Creative-Commons-naming-convention inference, NOT confirmed
// against a real API response — flagged in the PR description. Everything
// else (non-commercial, custom terms, unlicensed) is excluded until Todd
// Reese reviews Movebank's data-use terms for a commercial product.
export const COMMERCIAL_SAFE_LICENSES = ['CC_0', 'CC_BY'];

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

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // 20MB hard cap on any single fetch

async function fetchTextCapped(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Movebank HTTP ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
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
};

const MAX_STUDY_ROWS = 20000;

// Movebank has no server-side taxon or geographic filter for study
// discovery (see file header) — this fetches every study the account can
// see download access to, and the caller filters by species name, distance,
// and license client-side. `i_have_download_access=true` is a real
// documented query parameter and meaningfully narrows the result set.
export async function fetchMovebankStudies(): Promise<MovebankStudy[]> {
  const url = 'https://www.movebank.org/movebank/service/direct-read'
    + '?entity_type=study&i_have_download_access=true'
    + '&attributes=id,name,main_location_lat,main_location_long,number_of_individuals,taxon_ids,license_type,citation,i_have_download_access';

  const text = await fetchTextCapped(url, 30000);
  const rows = parseCsv(text, MAX_STUDY_ROWS);

  return rows
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
    }))
    .filter(s => s.lat !== null && !isNaN(s.lat) && s.lon !== null && !isNaN(s.lon));
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

const RATE_LIMIT_DELAY_MS = 1100;
const MAX_EVENT_ROWS = 250000;
const YEARS_OF_HISTORY = 5;
const GPS_SENSOR_TYPE_ID = 653; // confirmed: Movebank's numeric id for GPS sensors

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function movebankTimestamp(date: Date): string {
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

export async function fetchMovebankEvents(studyId: string): Promise<MovebankEvent[]> {
  await sleep(RATE_LIMIT_DELAY_MS);

  const timestampStart = movebankTimestamp(new Date(Date.now() - YEARS_OF_HISTORY * 365 * 86400000));
  const url = 'https://www.movebank.org/movebank/service/direct-read'
    + `?entity_type=event&study_id=${studyId}&sensor_type_id=${GPS_SENSOR_TYPE_ID}`
    + `&timestamp_start=${timestampStart}`
    + '&attributes=individual_id,timestamp,location_lat,location_long';

  const text = await fetchTextCapped(url, 20000);
  if (isAccessDenied(text)) return [];

  const rows = parseCsv(text, MAX_EVENT_ROWS);
  const events: MovebankEvent[] = [];
  for (const r of rows) {
    const lat = parseFloat(r.location_lat ?? r['location-lat']);
    const lon = parseFloat(r.location_long ?? r['location-long']);
    if (!r.timestamp || isNaN(lat) || isNaN(lon)) continue;
    events.push({ individualId: r.individual_id ?? r['individual-id'] ?? '', timestamp: r.timestamp, lat, lon });
  }
  return events;
}
