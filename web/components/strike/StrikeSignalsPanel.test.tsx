// FF-099: the Signals tab as rendered (collapsed cards; expanded rows are covered by signalCards.test.ts).
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SignalsBody } from './StrikeSignalsPanel'
import { groupSignals, type Signal } from '@/lib/strike/signalCards'
import SignalChipRow from './SignalChipRow'

let n = 0
const sig = (agent_key: string, observed_value: number | null, minutesAgo: number, source = 'observed'): Signal => ({
  id: `s${++n}`, agent_key, objective_id: 'o1', observed_value, source,
  recorded_at: new Date(Date.UTC(2026, 9, 8, 12) - minutesAgo * 60000).toISOString(),
})

describe('Signals tab (Strawberry-style data)', () => {
  const html = renderToStaticMarkup(
    <SignalsBody groups={groupSignals([
      sig('OUTDOOR_HATCH_WINDOW', 0.3333, 1),
      sig('OUTDOOR_USGS_WATER_TEMP', 7.5, 2),
      sig('OUTDOOR_USGS_STREAMFLOW_STATE', 2490, 3),
      sig('OUTDOOR_MOON_PHASE', 9, 4),
      sig('OUTDOOR_MOON_PHASE', 16, 60 * 24),
      sig('OUTDOOR_NOAA_TEMP', 0, 5, 'estimated'),
    ])} />,
  )

  it('shows each group with its own value and unit', () => {
    expect(html).toContain('Hatch window')
    expect(html).toContain('Low, 0.33')
    expect(html).toContain('Water temperature')
    expect(html).toContain('45.5 F')
    expect(html).toContain('(7.5 C)')
    expect(html).toContain('Streamflow')
    expect(html).toContain('2,490 cfs')
  })

  it('water temperature and the hatch score say they come from a reference gauge', () => {
    expect(html).toContain('Water temperature (reference gauge, not this water)')
    expect(html).toContain('Hatch window score (based on a reference gauge, not this water)')
    expect(html.split('A reference gauge, not the water at your spot.').length - 1).toBe(2)
  })

  it('the streamflow card says it is state-level and defines cfs', () => {
    expect(html).toContain('State-level streamflow (not this water)')
    expect(html).toContain('A state-wide reading, not the flow at your spot.')
    expect(html).toContain('cfs = cubic feet per second')
  })

  it('the moon card has the picture and the word waning', () => {
    expect(html).toContain('aria-label="Moon, 9% lit, waning"')
    expect(html).toContain('9% lit, waning crescent')
  })

  it('air temperature with only placeholder zeros says No data', () => {
    expect(html).toContain('Air temperature')
    expect(html).toContain('No data')
    expect(html).not.toContain('0.00')
  })

  it('no alpha-background utilities', () => {
    expect(html).not.toMatch(/class="[^"]*(bg-[a-z]+-\d+\/\d+|opacity-)/)
  })
})

describe('chip row', () => {
  it('renders nothing for no chips, and a moon chip with its picture', () => {
    expect(renderToStaticMarkup(<SignalChipRow chips={[]} />)).toBe('')
    const html = renderToStaticMarkup(<SignalChipRow chips={[
      { label: 'Water', value: '46 F' },
      { label: 'Moon', value: '9% waning', moon: { percent: 9, waxing: false } },
    ]} />)
    expect(html).toContain('Water')
    expect(html).toContain('46 F')
    expect(html).toContain('aria-label="Moon, 9% lit, waning"')
  })
})
