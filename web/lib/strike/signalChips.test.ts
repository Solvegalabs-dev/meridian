// FF-099 Part 4: chips come from real readings only.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSignalChips, MAX_CHIPS } from './signalChips'
import type { Reading } from './signalFormat'

const NOW = new Date(Date.UTC(2026, 9, 8, 12))
const r = (agent_key: string, observed_value: number | null, hoursAgo: number, source = 'observed'): Reading => ({
  agent_key, observed_value, source, recorded_at: new Date(NOW.getTime() - hoursAgo * 3600000).toISOString(),
})

describe('buildSignalChips', () => {
  it('worded by the shared table: water, state flow, moon', () => {
    const chips = buildSignalChips([
      r('OUTDOOR_USGS_WATER_TEMP', 7.5, 1),
      r('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 2),
      r('OUTDOOR_MOON_PHASE', 9, 3),
      r('OUTDOOR_MOON_PHASE', 16, 27),
    ], NOW)
    expect(chips.map(c => `${c.label} ${c.value}`)).toEqual(['Water 46 F', 'State flow 2,490 cfs', 'Moon 9% waning'])
    expect(chips[2].moon).toEqual({ percent: 9, waxing: false })
    expect(chips.every(c => c.recorded_at)).toBe(true)
  })

  it('never "Flow" alone: streamflow is always "State flow"', () => {
    const [chip] = buildSignalChips([r('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 1)], NOW)
    expect(chip.label).toBe('State flow')
  })

  it('placeholder zeros, indexes and unlisted agents give no chip', () => {
    const chips = buildSignalChips([
      r('OUTDOOR_NOAA_TEMP', 0, 1, 'estimated'),
      r('OUTDOOR_USGS_WATER_TEMP', 0, 1, 'estimated'),
      r('OUTDOOR_NOAA_DROUGHT_STATE', 2, 1),
      r('OUTDOOR_SOMETHING_NEW', 5, 1),
    ], NOW)
    expect(chips).toEqual([])
  })

  it('nothing real means no chips at all', () => {
    expect(buildSignalChips([], NOW)).toEqual([])
  })

  it('uses the newest real reading of an agent, skipping a newer placeholder', () => {
    const [chip] = buildSignalChips([r('OUTDOOR_USGS_WATER_TEMP', 0, 1, 'estimated'), r('OUTDOOR_USGS_WATER_TEMP', 10, 5)], NOW)
    expect(chip.value).toBe('50 F')
  })

  it('readings older than the window are not "latest"', () => {
    expect(buildSignalChips([r('OUTDOOR_USGS_WATER_TEMP', 10, 24 * 20)], NOW)).toEqual([])
  })

  it('at most five, newest data first', () => {
    const chips = buildSignalChips([
      r('OUTDOOR_USGS_WATER_TEMP', 7, 6), r('OUTDOOR_USGS_STREAMFLOW_STATE', 100, 5), r('OUTDOOR_MOON_PHASE', 9, 4),
      r('OUTDOOR_HATCH_WINDOW', 0.5, 3), r('OUTDOOR_WINDY_API', 8, 2), r('OUTDOOR_USGS_DISSOLVED_O2', 8, 1),
    ], NOW)
    expect(chips).toHaveLength(MAX_CHIPS)
    expect(chips[0].label).toBe('Oxygen')
    expect(chips.map(c => c.label)).not.toContain('Water')
  })
})

describe('the placeholder chips are gone', () => {
  const ROOT = join(__dirname, '..', '..')
  for (const file of ['app/(strike)/strike/[id]/page.tsx', 'app/api/mip/brief/route.ts']) {
    it(`${file} has no hard-coded chip text`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const old of ['Waning 34%', 'D2–D3', 'NW 8mph', '53% target', 'Below avg', 'CHIP_MAP', 'Monitoring']) {
        expect(src, old).not.toContain(old)
      }
      expect(src).toContain('loadSignalChips')
    })
  }
})
