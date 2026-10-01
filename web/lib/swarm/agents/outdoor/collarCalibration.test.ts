import { describe, it, expect, vi } from 'vitest'
import { calibrateCollarPattern, parseTempF, type CollarPatternRow } from './collarCalibration'

const BASE_ROW: CollarPatternRow = {
  peak_movement_windows: [{ window_start_hour: 6, window_end_hour: 9, confidence: 0.8, label: 'pre-dawn thermal' }],
  median_bedding_ft: 8500,
  bedding_p25_ft: 8200,
  bedding_p75_ft: 8800,
  drought_modifiers: {
    D0: { window_shift_hours: 0, elevation_shift_ft: 0 },
    D1: { window_shift_hours: -1, elevation_shift_ft: 200 },
    D2: { window_shift_hours: -2, elevation_shift_ft: 500 },
    D3: { window_shift_hours: -3, elevation_shift_ft: 800 },
    D4: { window_shift_hours: -4, elevation_shift_ft: 1100 },
  },
  temp_suppression_f: 75,
  aligns_ff080: true,
  confidence_tier: 2,
  local_tz: 'America/Denver',
  years_coverage: '2020–2025',
  data_owner_credit: 'Smith et al. (2020). Elk movement study.',
}

describe('calibrateCollarPattern (Fix 4 — full drought table looked up at read time)', () => {
  it.each(['D0', 'D1', 'D2', 'D3', 'D4'] as const)('applies the %s modifier shift', (level) => {
    const out = calibrateCollarPattern(BASE_ROW, { droughtLevel: level })
    const expectedShift = BASE_ROW.drought_modifiers![level].window_shift_hours
    const shiftedStart = (((6 + expectedShift) % 24) + 24) % 24
    expect(out.calibrated_windows[0].window.startsWith(String(shiftedStart).padStart(2, '0'))).toBe(true)
  })

  it('applies no shift for "none" or "unknown" drought levels', () => {
    const none = calibrateCollarPattern(BASE_ROW, { droughtLevel: 'none' })
    const unknown = calibrateCollarPattern(BASE_ROW, { droughtLevel: 'unknown' })
    const noModifier = calibrateCollarPattern(BASE_ROW, {})
    expect(none.calibrated_windows[0].window).toBe(noModifier.calibrated_windows[0].window)
    expect(unknown.calibrated_windows[0].window).toBe(noModifier.calibrated_windows[0].window)
    expect(none.calibrated_windows[0].condition_adjusted).toBe(false)
  })

  it('labels an unshifted window as "Collar-observed", never "Collar-confirmed"', () => {
    const out = calibrateCollarPattern(BASE_ROW, { droughtLevel: 'D0' })
    expect(out.calibrated_windows[0].action).toBe('Collar-observed pre-dawn thermal window')
    expect(out.calibrated_windows[0].action).not.toContain('confirmed')
  })

  it('labels a drought-shifted window as adjusted', () => {
    const out = calibrateCollarPattern(BASE_ROW, { droughtLevel: 'D2' })
    expect(out.calibrated_windows[0].action).toBe('Collar-observed pre-dawn thermal window (adjusted for drought)')
    expect(out.calibrated_windows[0].condition_adjusted).toBe(true)
  })

  it('builds data_credit from the stored citation, not a generic "Movebank study <id>" string', () => {
    const out = calibrateCollarPattern(BASE_ROW, {})
    expect(out.data_credit).toBe('Movebank GPS collar data — Smith et al. (2020). Elk movement study. (2020–2025)')
  })

  it('suppresses midday priority when the current temperature exceeds temp_suppression_f', () => {
    const hotRow: CollarPatternRow = {
      ...BASE_ROW,
      peak_movement_windows: [{ window_start_hour: 11, window_end_hour: 13, confidence: 0.9, label: 'midday lull' }],
    }
    const out = calibrateCollarPattern(hotRow, { currentTempF: 90 })
    expect(out.calibrated_windows[0].priority).toBe('low')
  })
})

describe('parseTempF (Fix 6e — temperature chip parsing)', () => {
  it('parses a plain number', () => {
    expect(parseTempF('72')).toBe(72)
  })

  it('parses a degree-suffixed string like "54°F"', () => {
    expect(parseTempF('54°F')).toBe(54)
  })

  it('parses negative and decimal values', () => {
    expect(parseTempF('-3.5°F')).toBe(-3.5)
  })

  it('returns undefined for empty, missing, or non-numeric values', () => {
    expect(parseTempF('')).toBeUndefined()
    expect(parseTempF(undefined)).toBeUndefined()
    expect(parseTempF(null)).toBeUndefined()
    expect(parseTempF('miss')).toBeUndefined()
  })
})

describe('findCollarPattern (Fix 5 — species resolution via resolveMovebankTaxon)', () => {
  it('returns null without querying the DB when the taxonomy key has no Movebank mapping', async () => {
    const fromSpy = vi.fn()
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: () => ({ from: fromSpy }),
    }))
    vi.resetModules()
    const { findCollarPattern } = await import('./collarCalibration')

    const result = await findCollarPattern('trout.rainbow.fly_fishing', 40.5, -110.0, 6)

    expect(result).toBeNull()
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

// --- FF-093 Phase 2 Task 0 (A9) — compliance gate ---
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'like', 'limit', 'order'].forEach(m => { chain[m] = vi.fn(() => chain) })
  chain.maybeSingle = vi.fn(async () => result)
  return chain
}

describe('isCollarDisplayAllowed (Phase 2 Task 0 — A9 compliance gate)', () => {
  it('returns false when there is no switch row for the state (missing = no display)', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      if (table === 'collar_compliance_switch') return makeChain({ data: null })
      throw new Error(`unexpected table ${table}`)
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { isCollarDisplayAllowed } = await import('./collarCalibration')

    expect(await isCollarDisplayAllowed('UT', undefined)).toBe(false)
  })

  it('returns false when the switch row exists but display_enabled is false', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      if (table === 'collar_compliance_switch') return makeChain({ data: { display_enabled: false } })
      throw new Error(`unexpected table ${table}`)
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { isCollarDisplayAllowed } = await import('./collarCalibration')

    expect(await isCollarDisplayAllowed('UT', undefined)).toBe(false)
  })

  it('returns true when the switch row has display_enabled true', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      if (table === 'collar_compliance_switch') return makeChain({ data: { display_enabled: true } })
      throw new Error(`unexpected table ${table}`)
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { isCollarDisplayAllowed } = await import('./collarCalibration')

    expect(await isCollarDisplayAllowed('UT', undefined)).toBe(true)
  })

  it('returns true for an approved tester regardless of the switch, without even checking it', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: { user_id: 'tester-1' } })
      if (table === 'collar_compliance_switch') return makeChain({ data: { display_enabled: false } })
      throw new Error(`unexpected table ${table}`)
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { isCollarDisplayAllowed } = await import('./collarCalibration')

    expect(await isCollarDisplayAllowed('UT', 'tester-1')).toBe(true)
    expect(fromSpy).not.toHaveBeenCalledWith('collar_compliance_switch')
  })

  it('returns false when no stateCode is given and the viewer is not a tester', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      throw new Error(`unexpected table ${table}`)
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { isCollarDisplayAllowed } = await import('./collarCalibration')

    expect(await isCollarDisplayAllowed(undefined, 'some-user')).toBe(false)
  })
})

describe('getCollarBriefAugmentation (Phase 2 Task 0 — no window shown unless compliance allows it)', () => {
  it('returns no windows and never queries collar_pattern_library when the switch is off (missing)', async () => {
    const patternLibrarySpy = vi.fn()
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      if (table === 'collar_compliance_switch') return makeChain({ data: null })
      if (table === 'collar_pattern_library') { patternLibrarySpy(); return makeChain({ data: null }) }
      return makeChain({ data: null })
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { getCollarBriefAugmentation } = await import('./collarCalibration')

    const result = await getCollarBriefAugmentation('elk.bull.archery', 40.5, -110.0, 'elk_hunt', 'UT', undefined)

    expect(result).toEqual({ windows: [], credit: null })
    expect(patternLibrarySpy).not.toHaveBeenCalled() // compliance checked BEFORE the pattern lookup
  })

  it('returns no windows when the switch explicitly disables display for the state', async () => {
    const patternLibrarySpy = vi.fn()
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: null })
      if (table === 'collar_compliance_switch') return makeChain({ data: { display_enabled: false } })
      if (table === 'collar_pattern_library') { patternLibrarySpy(); return makeChain({ data: null }) }
      return makeChain({ data: null })
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { getCollarBriefAugmentation } = await import('./collarCalibration')

    const result = await getCollarBriefAugmentation('elk.bull.archery', 40.5, -110.0, 'elk_hunt', 'UT', undefined)

    expect(result).toEqual({ windows: [], credit: null })
    expect(patternLibrarySpy).not.toHaveBeenCalled()
  })

  it('proceeds to look up a pattern when an approved tester views a state with display disabled', async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === 'collar_display_testers') return makeChain({ data: { user_id: 'tester-1' } })
      if (table === 'collar_compliance_switch') return makeChain({ data: { display_enabled: false } })
      if (table === 'collar_pattern_library') return makeChain({ data: null }) // no pattern found — but the lookup ran
      return makeChain({ data: null })
    })
    vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: fromSpy }) }))
    vi.resetModules()
    const { getCollarBriefAugmentation } = await import('./collarCalibration')

    await getCollarBriefAugmentation('elk.bull.archery', 40.5, -110.0, 'elk_hunt', 'UT', 'tester-1')

    expect(fromSpy).toHaveBeenCalledWith('collar_pattern_library')
  })
})
