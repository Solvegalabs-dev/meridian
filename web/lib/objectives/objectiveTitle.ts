import { isFishingTaxonomyKey } from '@/lib/strike/config/fishing-taxonomy'

// Readable objective titles (FF-095 Part 2). Pure: no I/O, no coordinates.
//   "salmon.sockeye.river_migration"            -> "Sockeye salmon, river migration"
//   "trout.rainbow.fly_fishing" + UT            -> "Rainbow trout, fly fishing (Utah)"
//   "elk.cow.archery" + UT + EA2004             -> "EA2004 antlerless elk (Utah)"
// With a hunt number the method is left out: the number already names the hunt.

export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

// Species roots the taxonomy uses: species.variety-or-sex.method. Anything else is cleaned, not reordered.
const KNOWN_SPECIES = new Set(['elk', 'deer', 'turkey', 'moose', 'caribou', 'pronghorn', 'salmon', 'trout'])

// Sex segments read as antlerless/bull/buck; every other second segment is a variety (mule, sockeye).
const SEX_WORDS: Record<string, string> = { bull: 'bull', buck: 'buck', cow: 'antlerless', doe: 'antlerless' }

const MAX_WATER_BODY = 60
// A decimal degree value such as 40.5123 or -111.2. Titles never carry a coordinate.
const COORDINATE_LIKE = /-?\d{1,3}\.\d{3,}/

export type ObjectiveTitleInput = {
  taxonomyKey: string | null | undefined
  state?: string | null
  huntCode?: string | null
  waterBody?: string | null
}

function words(segment: string): string {
  return segment.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

export function stateName(state: string | null | undefined): string | null {
  const raw = (state ?? '').trim()
  if (!raw) return null
  const byCode = STATE_NAMES[raw.toUpperCase()]
  if (byCode) return byCode
  // A two-letter value that is not a state is dropped. A longer value is taken as a name already.
  if (raw.length <= 2) return null
  return raw.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function cleanWaterBody(waterBody: string | null | undefined): string | null {
  const cleaned = (waterBody ?? '').replace(/\s+/g, ' ').trim()
  if (!cleaned || COORDINATE_LIKE.test(cleaned)) return null
  return cleaned.slice(0, MAX_WATER_BODY)
}

// 'elk.cow.archery' -> { subject: 'antlerless elk', method: 'archery' }. Null for an unknown root.
function describeTaxonomy(taxonomyKey: string): { subject: string; method: string | null } | null {
  const [species, second, ...rest] = taxonomyKey.toLowerCase().split('.')
  if (!species || !KNOWN_SPECIES.has(species)) return null
  const modifier = second ? (SEX_WORDS[second] ?? words(second)) : ''
  const method = rest.length > 0 ? words(rest.join(' ')) : null
  return { subject: modifier ? `${modifier} ${species}` : species, method }
}

export function buildObjectiveTitle(input: ObjectiveTitleInput): string {
  const key = (input.taxonomyKey ?? '').trim()
  const described = key ? describeTaxonomy(key) : null
  // A fishing objective has no hunt number (FF-096b), even if a stale one is on the row.
  const huntCode = isFishingTaxonomyKey(key.toLowerCase()) ? '' : (input.huntCode ?? '').trim().toUpperCase()
  const water = cleanWaterBody(input.waterBody)
  const state = stateName(input.state)

  let core: string
  if (described) {
    const parts = [described.subject]
    if (described.method && !huntCode) parts.push(described.method)
    if (water) parts.push(water)
    core = parts.join(', ')
    if (huntCode) core = `${huntCode} ${core}`
  } else {
    core = words(key) || 'Objective'
    if (huntCode) core = `${huntCode} ${core}`
  }

  const titled = huntCode ? core : capitalizeFirst(core)
  return state ? `${titled} (${state})` : titled
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// True when a stored title is only the raw taxonomy key (how objectives were titled before FF-095):
// "elk · bull · archery", optionally followed by the hunt number.
export function isRawKeyTitle(title: string | null | undefined, taxonomyKey: string | null | undefined, huntCode?: string | null): boolean {
  const t = squash(title ?? '')
  if (!t) return true
  const key = squash(taxonomyKey ?? '')
  if (!key) return false
  if (t === key) return true
  const code = squash(huntCode ?? '')
  return code !== '' && t === `${key} ${code}`
}

// The stored title when it is a real one, otherwise a computed one. Stored titles are never rewritten here.
export function resolveObjectiveTitle(input: ObjectiveTitleInput & { storedTitle?: string | null }): string {
  const stored = (input.storedTitle ?? '').trim()
  if (stored && !isRawKeyTitle(stored, input.taxonomyKey, input.huntCode)) return stored
  return buildObjectiveTitle(input)
}
