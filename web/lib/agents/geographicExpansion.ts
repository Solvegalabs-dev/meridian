export type DomainExpansionRule = {
  domain: string;
  expandTo: string[];
  logic: string;
};

export const EXPANSION_RULES: DomainExpansionRule[] = [
  {
    domain: 'elk_hunt',
    expandTo: ['adjacent_wildlife_units', 'watershed', 'drainage_basin'],
    logic: 'Hunting: always include watershed geography and adjacent wildlife management units. Elk do not respect unit boundaries.',
  },
  {
    domain: 'real_estate',
    expandTo: ['commute_corridors', 'adjacent_zip_codes', 'school_district'],
    logic: 'RE: commute corridors and adjacent markets drive demand signals.',
  },
  {
    domain: 'credit_union',
    expandTo: ['regional_economic_zone', 'fed_district', 'peer_state'],
    logic: 'Auto finance: regional economic zones and Fed district peers drive macro signals.',
  },
  {
    domain: 'universal',
    expandTo: ['national'],
    logic: 'Universal agents always collect at national scope.',
  },
];

// Known adjacent wildlife units by primary Utah unit name/number
const ELK_ADJACENT_UNITS: Record<string, string[]> = {
  'Book Cliffs': ['Nine Mile', 'Uinta Basin', 'Central Mountains'],
  'Uinta Basin': ['Book Cliffs', 'Nine Mile', 'North Slope'],
  'North Slope': ['Uinta Basin', 'Cache', 'Rich'],
  'Nine Mile': ['Book Cliffs', 'Uinta Basin', 'Price'],
  'central mountains': ['Uinta Basin', 'Nine Mile', 'Manti'],
  'Duchesne': ['Uinta Basin', 'North Slope'],
  'Daggett': ['North Slope', 'Uinta Basin'],
};

// Known watershed/drainage basin associations for Utah elk units
const ELK_WATERSHEDS: Record<string, string> = {
  'Uinta Basin': 'Green River Drainage',
  'Book Cliffs': 'Price River / Green River Drainage',
  'Nine Mile': 'Price River Drainage',
  'North Slope': 'Bear River / Green River Drainage',
  'Duchesne': 'Duchesne River Drainage',
};

export type ResolvedGeo = {
  state: string;
  county: string;
  placeId: string;
  stationId: string;
  adjacentUnits: string[];
  watershed: string;
  domainKeyword: string;
};

export function applyExpansionRules(
  domain: string,
  baseGeo: Partial<ResolvedGeo>
): ResolvedGeo {
  const rule = EXPANSION_RULES.find(r => r.domain === domain);
  const state = baseGeo.state ?? 'UT';
  const county = baseGeo.county ?? '';
  const placeId = baseGeo.placeId ?? '8'; // Utah iNat place_id default
  const stationId = baseGeo.stationId ?? 'USC00420072'; // regional NOAA default

  let adjacentUnits: string[] = baseGeo.adjacentUnits ?? [];
  let watershed = baseGeo.watershed ?? '';

  if (rule && rule.expandTo.includes('adjacent_wildlife_units')) {
    // Look up by county or state unit name
    const lookupKey = county || state;
    const found = Object.entries(ELK_ADJACENT_UNITS).find(
      ([key]) => lookupKey.toLowerCase().includes(key.toLowerCase())
    );
    if (found && adjacentUnits.length === 0) {
      adjacentUnits = found[1];
    }
  }

  if (rule && rule.expandTo.includes('watershed')) {
    const lookupKey = county || state;
    const found = Object.entries(ELK_WATERSHEDS).find(
      ([key]) => lookupKey.toLowerCase().includes(key.toLowerCase())
    );
    if (found && !watershed) {
      watershed = found[1];
    }
  }

  const domainKeyword = buildDomainKeyword(domain, state, county);

  return {
    state,
    county,
    placeId,
    stationId,
    adjacentUnits,
    watershed,
    domainKeyword,
  };
}

function buildDomainKeyword(domain: string, state: string, county: string): string {
  const location = county ? `${county} ${state}` : state;
  switch (domain) {
    case 'elk_hunt':
      return `elk hunting ${location}`;
    case 'real_estate':
      return `real estate market ${location}`;
    case 'credit_union':
      return `auto finance credit ${location}`;
    default:
      return location;
  }
}
