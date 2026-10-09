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
  it('worded by the shared table: state flow, moon', () => {
    const chips = buildSignalChips([
      r('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 2),
      r('OUTDOOR_MOON_PHASE', 9, 3),
      r('OUTDOOR_MOON_PHASE', 16, 27),
    ], NOW)
    expect(chips.map(c => `${c.label} ${c.value}`)).toEqual(['State flow 2,490 cfs', 'Moon 9% waning'])
    expect(chips[1].moon).toEqual({ percent: 9, waxing: false })
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

  it('reference-gauge readings get no chip: water temperature, dissolved oxygen, turbidity, hatch score', () => {
    // The agents read a fixed Alaska gauge until they use the pin's own gauge, so they are not readings of this spot.
    const chips = buildSignalChips([
      r('OUTDOOR_USGS_WATER_TEMP', 7.5, 1), r('OUTDOOR_USGS_DISSOLVED_O2', 9, 1),
      r('OUTDOOR_USGS_TURBIDITY', 3, 1), r('OUTDOOR_HATCH_WINDOW', 0.33, 1),
    ], NOW)
    expect(chips).toEqual([])
  })

  it('uses the newest real reading of an agent, skipping a newer placeholder', () => {
    const [chip] = buildSignalChips([r('OUTDOOR_WINDY_API', 0, 1, 'estimated'), r('OUTDOOR_WINDY_API', 8, 5)], NOW)
    expect(chip.value).toBe('8 mph')
  })

  it('readings older than the window are not "latest"', () => {
    expect(buildSignalChips([r('OUTDOOR_WINDY_API', 10, 24 * 20)], NOW)).toEqual([])
  })

  it('newest data first, never more than the maximum', () => {
    const chips = buildSignalChips([
      r('OUTDOOR_USGS_STREAMFLOW_STATE', 100, 5), r('OUTDOOR_MOON_PHASE', 9, 4), r('OUTDOOR_WINDY_API', 8, 2),
    ], NOW)
    expect(chips.map(c => c.label)).toEqual(['Wind', 'Moon', 'State flow'])
    expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS)
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
