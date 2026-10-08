// FF-096b: the intake form limits trip dates to last year through three years ahead. The submit guard
// itself runs in the browser; here we check the date inputs carry the bounds and the rule they share
// with the server (checkTripDate) gives the message the form shows.
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikeNewPage from './page'
import { checkTripDate, tripDateBounds } from '@/lib/strike/tripDateRange'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))

describe('/strike/new trip dates', () => {
  const html = renderToStaticMarkup(createElement(StrikeNewPage))
  const dateInputs = html.match(/<input[^>]*type="date"[^>]*>/g) ?? []

  it('has a start and an end date input', () => {
    expect(dateInputs).toHaveLength(2)
  })

  it('both inputs carry min and max for last year through three years ahead', () => {
    const { min, max } = tripDateBounds()
    for (const input of dateInputs) {
      expect(input).toContain(`min="${min}"`)
      expect(input).toContain(`max="${max}"`)
    }
  })

  it('the message the form shows for the year 0027 or a far-future year names the allowed years', () => {
    const { minYear, maxYear } = tripDateBounds()
    expect(checkTripDate('0027-10-15', 'Trip start')).toContain('Trip start')
    expect(checkTripDate(`${maxYear + 1}-01-01`, 'Trip end')).toBe(`Trip dates must be between ${minYear} and ${maxYear}.`)
  })

  it('keeps the dark color scheme on the date inputs', () => {
    for (const input of dateInputs) expect(input).toContain('[color-scheme:dark]')
  })
})
