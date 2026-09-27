// FF-093 — Movebank GPS Collar Data Fetch
// Config layer: species taxon mapping + raw study/event retrieval against the
// Movebank REST API (HTTP Basic Auth, free registration, ~1 req/sec limit).

// Movebank taxon_id per taxonomy_key prefix (matched against the leading
// segment of an objective's taxonomy_key, e.g. 'elk.bull.archery' → 'elk').
export const MOVEBANK_TAXON_IDS: Record<string, number> = {
  elk: 9803,
  deer_mule: 42540,
  deer_whitetail: 2422117,
  moose: 30538,
  caribou: 786,
  pronghorn: 1896,
  salmon_king: 1035126,
  salmon_sockeye: 1035132,
  salmon_silver: 1035124,
};

// Maps a taxonomy_key (e.g. 'elk.bull.archery', 'deer.mule.archery',
// 'salmon.king.river_migration') to a Movebank taxon lookup key + a
// normalized species_taxon_key used as the collar_pattern_library routing key.
export function resolveMovebankTaxon(taxonomyKey: string): { taxonId: number; speciesTaxonKey: string } | null {
  const parts = taxonomyKey.split('.');
  const root = parts[0];
  const sub = parts[1];

  if (root === 'elk') return { taxonId: MOVEBANK_TAXON_IDS.elk, speciesTaxonKey: `elk.${sub ?? 'unspecified'}` };
  if (root === 'deer' && sub === 'mule') return { taxonId: MOVEBANK_TAXON_IDS.deer_mule, speciesTaxonKey: 'deer.mule' };
  if (root === 'deer' && sub === 'whitetail') return { taxonId: MOVEBANK_TAXON_IDS.deer_whitetail, speciesTaxonKey: 'deer.whitetail' };
  if (root === 'moose') return { taxonId: MOVEBANK_TAXON_IDS.moose, speciesTaxonKey: 'moose' };
  if (root === 'caribou') return { taxonId: MOVEBANK_TAXON_IDS.caribou, speciesTaxonKey: 'caribou' };
  if (root === 'pronghorn') return { taxonId: MOVEBANK_TAXON_IDS.pronghorn, speciesTaxonKey: 'pronghorn' };
  if (root === 'salmon' && sub === 'king') return { taxonId: MOVEBANK_TAXON_IDS.salmon_king, speciesTaxonKey: 'salmon.king' };
  if (root === 'salmon' && sub === 'sockeye') return { taxonId: MOVEBANK_TAXON_IDS.salmon_sockeye, speciesTaxonKey: 'salmon.sockeye' };
  if (root === 'salmon' && sub === 'silver') return { taxonId: MOVEBANK_TAXON_IDS.salmon_silver, speciesTaxonKey: 'salmon.silver' };

  return null;
}

export function hasMovebankCredentials(): boolean {
  return !!process.env.MOVEBANK_USERNAME && !!process.env.MOVEBANK_PASSWORD;
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.MOVEBANK_USERNAME}:${process.env.MOVEBANK_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

// Movebank's direct-read endpoint returns CSV.
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

export type MovebankStudy = {
  id: string;
  name: string;
  numberOfDeployedIndividuals: number;
};

export async function fetchMovebankStudies(taxonId: number): Promise<MovebankStudy[]> {
  const url = `https://www.movebank.org/movebank/service/direct-read?entity_type=study&taxon_ids=${taxonId}&attributes=id,name,number_of_deployed_individuals,study_area`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Movebank study discovery HTTP ${response.status}`);

  const rows = parseCsv(await response.text());
  return rows
    .filter(r => r.id)
    .map(r => ({
      id: r.id,
      name: r.name ?? '',
      numberOfDeployedIndividuals: parseInt(r.number_of_deployed_individuals ?? '0', 10) || 0,
    }));
}

export type MovebankEvent = {
  individualId: string;
  timestamp: string;
  lat: number;
  lon: number;
};

const RATE_LIMIT_DELAY_MS = 1100;
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchMovebankEvents(studyId: string): Promise<MovebankEvent[]> {
  await sleep(RATE_LIMIT_DELAY_MS);

  const url = `https://www.movebank.org/movebank/service/direct-read?entity_type=event&study_id=${studyId}&attributes=individual_id,timestamp,location_lat,location_long`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Movebank event fetch HTTP ${response.status} (study ${studyId})`);

  const rows = parseCsv(await response.text());
  const events: MovebankEvent[] = [];
  for (const r of rows) {
    const lat = parseFloat(r.location_lat ?? r['location-lat']);
    const lon = parseFloat(r.location_long ?? r['location-long']);
    if (!r.timestamp || isNaN(lat) || isNaN(lon)) continue;
    events.push({ individualId: r.individual_id ?? r['individual-id'] ?? '', timestamp: r.timestamp, lat, lon });
  }
  return events;
}
