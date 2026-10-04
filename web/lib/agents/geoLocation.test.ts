import { describe, it, expect } from 'vitest'
import { hasLocation, shouldSkipForLocation, templateNeedsCoordinates, LOCATION_NOT_SET } from './geoLocation'

const ELIZABETH_TEMPLATE = 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast'
const STATE_ONLY_TEMPLATE = 'https://www.drought.gov/api/state/{state}/current.json'
const LOCAL = { lat: 40.989, lon: -110.333, nws_grid_office: 'SLC', nws_grid_x: 90, nws_grid_y: 130, state: 'UT' }
const NO_LOCATION = { lat: null, lon: null, nws_grid_office: null, nws_grid_x: null, nws_grid_y: null, state: null }

describe('coordinate and grid templates', () => {
  it('skip for an objective with no location, and never borrow another area', () => {
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, null)).toBe(true)
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, NO_LOCATION, 'UT')).toBe(true)
  })

  it('coordinates without an NWS grid still skip', () => {
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, { lat: 40.5, lon: -111, nws_grid_office: null, nws_grid_x: null, nws_grid_y: null })).toBe(true)
  })

  it('run normally for an objective with a location', () => {
    expect(hasLocation(LOCAL)).toBe(true)
    expect(shouldSkipForLocation(ELIZABETH_TEMPLATE, LOCAL)).toBe(false)
  })

  it('detect coordinate placeholders', () => {
    expect(templateNeedsCoordinates('https://x.gov/?lat={lat}&lon={lon}')).toBe(true)
    expect(templateNeedsCoordinates(STATE_ONLY_TEMPLATE)).toBe(false)
  })
})

describe('state-only templates (OUTDOOR_NOAA_DROUGHT_STATE, OUTDOOR_NOAA_DROUGHT_COUNTY)', () => {
  it('run with no profile when the run context knows the state', () => {
    expect(shouldSkipForLocation(STATE_ONLY_TEMPLATE, null, 'UT')).toBe(false)
  })

  it('run for an objective with no coordinates when its profile has a state', () => {
    expect(shouldSkipForLocation(STATE_ONLY_TEMPLATE, NO_LOCATION_WITH_STATE, null)).toBe(false)
  })

  it('skip with no state anywhere, and need no coordinates', () => {
    expect(shouldSkipForLocation(STATE_ONLY_TEMPLATE, null, null)).toBe(true)
    expect(shouldSkipForLocation(STATE_ONLY_TEMPLATE, NO_LOCATION, '')).toBe(true)
  })
})

const NO_LOCATION_WITH_STATE = { ...NO_LOCATION, state: 'UT' }

describe('templates with no location placeholders', () => {
  it('always run, even with no profile and no state', () => {
    expect(shouldSkipForLocation('https://example.gov/static-feed.json', null, null)).toBe(false)
  })
})

describe('skip reason', () => {
  it('is the stable code the run log records', () => {
    expect(LOCATION_NOT_SET).toBe('location_not_set')
  })
})
