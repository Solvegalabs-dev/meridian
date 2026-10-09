// FF-100: the fishing bundles, the migration and the registry of display entries agree with each other.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FISHING_TAXONOMY } from '@/lib/strike/config/fishing-taxonomy'
import { AGENTS } from '@/lib/strike/signalFormat'

const ROOT = join(__dirname, '..', '..')
const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '20261008_ff100_spot_data.sql'), 'utf8')
// The statements only, without the explanatory comments.
const code = sql.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join(' ')

const bundles = Object.entries(FISHING_TAXONOMY) as Array<[string, { agent_bundle: readonly string[]; signal_chips: ReadonlyArray<{ agent: string }> }]>

describe('fishing bundles', () => {
  it('every fishing bundle uses the nearby-gauge streamflow agent and has wind', () => {
    for (const [key, t] of bundles) {
      expect(t.agent_bundle, key).toContain('OUTDOOR_USGS_STREAMFLOW_NEAR')
      expect(t.agent_bundle, key).not.toContain('OUTDOOR_USGS_STREAMFLOW_STATE')
      expect(t.agent_bundle, key).toContain('OUTDOOR_WINDY_API')
      expect(t.signal_chips.map(c => c.agent), key).not.toContain('OUTDOOR_USGS_STREAMFLOW_STATE')
    }
  })

  it('the streamflow chip entries point at the nearby-gauge agent', () => {
    for (const [key, t] of bundles) {
      expect(t.signal_chips.map(c => c.agent), key).toContain('OUTDOOR_USGS_STREAMFLOW_NEAR')
    }
  })
})

describe('registry completeness (display side)', () => {
  it('every agent in a fishing bundle has an AGENTS entry', () => {
    const missing = new Set<string>()
    for (const [, t] of bundles) for (const a of [...t.agent_bundle, ...t.signal_chips.map(c => c.agent)]) if (!AGENTS[a]) missing.add(a)
    expect(Array.from(missing)).toEqual([])
  })

  it('every agent this migration inserts into agent_configs has an AGENTS entry', () => {
    const insert = sql.slice(sql.indexOf('INSERT INTO agent_configs'), sql.indexOf('ON CONFLICT (agent_key)'))
    const keys = Array.from(insert.matchAll(/'(OUTDOOR_[A-Z0-9_]+)'/g)).map(m => m[1])
    expect(keys).toContain('OUTDOOR_USGS_STREAMFLOW_NEAR')
    for (const k of keys) expect(AGENTS[k], k).toBeDefined()
  })
})

describe('the migration', () => {
  it('adds source_detail as a nullable jsonb column, idempotently', () => {
    expect(sql).toMatch(/ALTER TABLE agent_signal_history ADD COLUMN IF NOT EXISTS source_detail jsonb;/)
    expect(sql).not.toMatch(/source_detail jsonb\s+(NOT NULL|DEFAULT)/i)
  })

  it('points the three water agents at the pin gauges, not the Alaska placeholder', () => {
    for (const code of ['00010', '00300', '63680']) {
      expect(sql).toContain(`sites={usgs_gauge_ids}&parameterCd=${code}&siteStatus=active`)
    }
    expect(sql).not.toContain('sites=15266300')
  })

  it('inserts the nearby-gauge streamflow agent with the same flow parameter and keeps the state agent', () => {
    expect(sql).toContain("'OUTDOOR_USGS_STREAMFLOW_NEAR'")
    expect(sql).toContain('sites={usgs_gauge_ids}&parameterCd=00060&siteStatus=active')
    expect(sql).toMatch(/ON CONFLICT \(agent_key\) DO UPDATE/)
    // It never deactivates the state-level agent that hunting objectives use.
    expect(sql).not.toMatch(/OUTDOOR_USGS_STREAMFLOW_STATE'[\s\S]{0,80}is_active\s*=\s*false/i)
  })

  it('swaps streamflow and adds wind for fishing profiles only', () => {
    expect(sql).toContain("array_replace(assigned_agents, 'OUTDOOR_USGS_STREAMFLOW_STATE', 'OUTDOOR_USGS_STREAMFLOW_NEAR')")
    expect(sql).toContain("array_append(assigned_agents, 'OUTDOOR_WINDY_API')")
    const updates = sql.split(/UPDATE objective_profiles/).slice(1)
    expect(updates).toHaveLength(2)
    for (const u of updates) expect(u).toContain("domain = 'fishing'")
  })

  it('uses the NWS hourly forecast for air temperature and precipitation, and no Grand Junction URL anywhere', () => {
    expect(sql).toContain("https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast/hourly")
    expect(sql).toContain("'CALCULATED:nws_station_pressure'")
    expect(code).not.toContain('GJT')
    expect(code).not.toContain('/observations')
  })

  it('never deletes or rewrites stored readings', () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+agent_signal_history/i)
    expect(sql).not.toMatch(/UPDATE\s+agent_signal_history/i)
    expect(sql).not.toMatch(/TRUNCATE/i)
  })

  it('does not change grants or row-level security', () => {
    expect(sql).not.toMatch(/GRANT|REVOKE|POLICY|ROW LEVEL SECURITY/i)
  })
})

describe('the loaders ask for source_detail', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
  it('the Signals API, the evidence loader and the chip loader all select it', () => {
    expect(read('app/api/strike/signals/route.ts')).toContain('source_detail')
    expect(read('lib/strikeBrief/evidence.ts')).toContain("recorded_at, source_detail'")
    expect(read('lib/strike/signalChips.ts')).toContain("recorded_at, source_detail'")
  })
})
