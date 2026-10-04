import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpotsView, atLimit, boundaryWarning, headerText, type SpotView } from './SpotsPanel'

const spot = (id: string, name: string, over: Partial<SpotView> = {}): SpotView => ({
  id, name, lat: 40.917, lon: -111.397, is_active: false, county: 'Summit', state: 'UT', hunt_unit_id: null, ...over,
})

describe('SpotsView', () => {
  it('header reads "Hunt spots, 2 of 3"', () => {
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [spot('a', 'North'), spot('b', 'Fish Lake')], limit: 3, active_spot_id: null }} />)
    expect(html).toContain('Hunt spots, 2 of 3')
  })

  it('marks only the active spot with "Strike focus"', () => {
    const html = renderToStaticMarkup(
      <SpotsView
        state={{ spots: [spot('a', 'North', { is_active: true }), spot('b', 'Fish Lake')], limit: 3, active_spot_id: 'a' }}
        onMakeActive={() => {}}
      />,
    )
    expect(html.match(/Strike focus/g)).toHaveLength(1)
    expect(html).toContain('Make focus')
  })

  it('at the limit the add button is disabled and the copy says more is coming', () => {
    const spots = [spot('a', 'A'), spot('b', 'B'), spot('c', 'C')]
    const html = renderToStaticMarkup(<SpotsView state={{ spots, limit: 3, active_spot_id: 'a' }} onAdd={() => {}} />)
    expect(html).toContain('Spot limit reached')
    expect(html).toContain('More spots coming with higher plans')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('+ Add a spot')
  })

  it('under the limit the add button is enabled', () => {
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [spot('a', 'A')], limit: 3, active_spot_id: 'a' }} onAdd={() => {}} />)
    expect(html).toContain('+ Add a spot')
    expect(html).not.toContain('disabled=""')
  })

  it('shows coordinates at 4 decimals and the county', () => {
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [spot('a', 'A')], limit: 3, active_spot_id: null }} />)
    expect(html).toContain('40.9170, -111.3970')
    expect(html).toContain('Summit')
  })

  it('text is 14 px or larger; touch targets are 44 px', () => {
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [spot('a', 'A')], limit: 3, active_spot_id: null }} onAdd={() => {}} onMakeActive={() => {}} />)
    expect(html).not.toMatch(/text-\[(9|10|11|12)px\]/)
    expect(html).toContain('min-h-[44px]')
  })
})

describe('header and limit helpers', () => {
  it('uncapped accounts see no denominator', () => {
    expect(headerText(4, null)).toBe('Hunt spots, 4')
  })

  it('atLimit is true only at or over the cap', () => {
    expect(atLimit(2, 3)).toBe(false)
    expect(atLimit(3, 3)).toBe(true)
    expect(atLimit(99, null)).toBe(false)
  })
})

describe('boundary warning', () => {
  const base = spot('a', 'North')

  it('outside the hunt boundary: a warning naming the hunt number', () => {
    const outside = { ...base, inside_boundary: false }
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [outside], limit: 3, active_spot_id: null }} huntCode="EA2004" />)
    expect(html).toContain('This spot is outside the EA2004 boundary. Strike briefs will still use these coordinates.')
  })

  it('inside the boundary: no warning', () => {
    const inside = { ...base, inside_boundary: true }
    const html = renderToStaticMarkup(<SpotsView state={{ spots: [inside], limit: 3, active_spot_id: null }} huntCode="EA2004" />)
    expect(html).not.toContain('outside the')
  })

  it('no boundary (null) or no hunt number: no warning, not "outside"', () => {
    const unknown = { ...base, inside_boundary: null }
    expect(renderToStaticMarkup(<SpotsView state={{ spots: [unknown], limit: 3, active_spot_id: null }} huntCode="EA2004" />)).not.toContain('outside the')
    const outside = { ...base, inside_boundary: false }
    expect(renderToStaticMarkup(<SpotsView state={{ spots: [outside], limit: 3, active_spot_id: null }} />)).not.toContain('outside the')
    expect(boundaryWarning(outside, null)).toBeNull()
  })
})
