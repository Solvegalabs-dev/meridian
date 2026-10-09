// FF-099 Part 3: the moon picture.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MoonIcon, { moonIconGeometry } from './MoonIcon'

describe('moonIconGeometry', () => {
  it('a crescent curves back (sweep 0) and a gibbous bulges (sweep 1)', () => {
    expect(moonIconGeometry(9, false).sweep).toBe(0)
    expect(moonIconGeometry(75, true).sweep).toBe(1)
  })

  it('the terminator is narrowest near half and widest near new or full', () => {
    expect(moonIconGeometry(50, true).rx).toBe(0)
    expect(moonIconGeometry(10, true).rx).toBeGreaterThan(moonIconGeometry(40, true).rx)
  })

  it('waning is drawn mirrored, waxing is not', () => {
    expect(moonIconGeometry(9, false).mirrored).toBe(true)
    expect(moonIconGeometry(9, true).mirrored).toBe(false)
  })

  it('new moon draws nothing lit; full moon the whole disc', () => {
    expect(moonIconGeometry(0, true).kind).toBe('new')
    expect(moonIconGeometry(100, true).kind).toBe('full')
    expect(moonIconGeometry(25, true).kind).toBe('partial')
  })
})

describe('MoonIcon', () => {
  it('is a labeled picture, 40px by default', () => {
    const html = renderToStaticMarkup(<MoonIcon percent={9} waxing={false} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Moon, 9% lit, waning"')
    expect(html).toContain('width="40"')
    expect(html).toContain('scale(-1,1)')
  })
})
