import { describe, it, expect } from 'vitest'
import { hasLocation, shouldSkipForLocation, templateNeedsLocation, LOCATION_NOT_SET } from './geoLocation'

const ELIZABETH_TEMPLATE = 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast'
const LOCAL = { lat: 40.989, lon: -110.333, nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, state: 'UT' }

describe('location rules for geo-templated agents', () => {
  it('objective with no location: a weather template is skipped, not sent to Elizabeth Pass', () => {
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, null)).toBe(true)
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, { lat: null, lon: null, nws_grid_office: null, nws_grid_x: null, nws_grid_y: null })).toBe(true)
  })

  it('coordinates without an NWS grid still skip a weather template', () => {
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, { lat: 40.5, lon: -111, nws_grid_office: null, nws_grid_x: null, nws_grid_y: null })).toBe(true)
  })

  it('objective with a location runs its templates unchanged', () => {
    expect(hasLocation(LOCAL)).toBe(true)
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, LOCAL)).toBe(false)
  })

  it('templates with no location placeholders always run, even with no profile', () => {
    expect(shouldSkipForLocation('https://example.gov/static-feed.json', null)).toBe(false)
  })

  it('a {state} template needs a location too', () => {
    expect(templateNeedsLocation('https://x.gov/{state}/feed')).toBe(true)
  })

  it('the skip reason is the stable code the run log records', () => {
    expect(LOCATION_NOT_SET).toBe('location_not_set')
  })
})
