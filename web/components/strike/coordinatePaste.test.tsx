// FF-097: the paste box reads Google Maps formats, says so when it cannot, and Save never sends empty coordinates.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PASTE_HELP,
  PASTE_PLACEHOLDER,
  PasteField,
  SpotForm,
  coordinatesTip,
  submitSpotForm,
} from './SpotsPanel'
import { COORDINATE_MESSAGE, PASTE_UNREADABLE_MESSAGE } from '@/lib/spots/coordinates'

const classAttrs = (html: string) => Array.from(html.matchAll(/class="([^"]*)"/g)).map(m => m[1])
const field = (value: string) => renderToStaticMarkup(<PasteField value={value} onChange={() => {}} />)

describe('PasteField', () => {
  it('shows the decimal placeholder and the helper text', () => {
    const html = field('')
    expect(PASTE_PLACEHOLDER).toBe('40.127, -111.020')
    expect(html).toContain('placeholder="40.127, -111.020"')
    expect(PASTE_HELP).toBe('Paste from Google Maps. Degrees and N, S, E, W are converted for you.')
    expect(html).toContain('Paste from Google Maps. Degrees and N, S, E, W are converted for you.')
  })

  it('shows the unreadable message under the field when text is present but cannot be read', () => {
    const html = field('abc')
    expect(html).toContain("Couldn&#x27;t read those coordinates. Try 40.127, -111.020.")
    expect(PASTE_UNREADABLE_MESSAGE).toBe("Couldn't read those coordinates. Try 40.127, -111.020.")
    expect(html).toContain('role="alert"')
  })

  it('keeps what the user typed in the box', () => {
    expect(field('abc')).toContain('value="abc"')
  })

  it('shows no message for an empty box, for blank spaces, or for text it can read', () => {
    for (const ok of ['', '   ', '40°07\'38.5"N 111°01\'13.7"W', '40.12739, -111.02011', '40.12739 N, 111.02011 W']) {
      expect(field(ok), ok).not.toContain('read those coordinates')
    }
  })

  it('shows the message for a half-reading too: one number, or out-of-range minutes', () => {
    expect(field('40.12739')).toContain('read those coordinates')
    expect(field('40°07\'75"N 111°01\'13.7"W')).toContain('read those coordinates')
  })

  it('text is 14 px (text-sm) or larger, with no alpha backgrounds or opacity', () => {
    const html = field('abc')
    for (const cls of classAttrs(html)) {
      expect(cls).not.toMatch(/\/\d+/)
      expect(cls).not.toMatch(/\bopacity-/)
      expect(cls).not.toMatch(/text-\[(\d|1[01])px\]/)
      expect(cls).not.toMatch(/\btext-xs\b/)
    }
    expect(html).toMatch(/<p class="text-sm[^"]*">Paste from Google Maps/)
    expect(html).toMatch(/<input[^>]*min-h-\[44px\]/)
  })
})

describe('the coordinates tip', () => {
  it('says "the water" for fishing and "the spot" for hunting', () => {
    expect(coordinatesTip(true)).toBe('Tip: long-press the water on Google Maps to copy its coordinates.')
    expect(coordinatesTip(false)).toBe('Tip: long-press the spot on Google Maps to copy its coordinates.')
  })
})

describe('SpotForm', () => {
  const noop = async () => null
  const render = (fishing: boolean) => renderToStaticMarkup(
    <SpotForm initial={{ name: '', lat: '', lon: '' }} submitLabel="Save spot" fishing={fishing} onSubmit={noop} onCancel={() => {}} />,
  )

  it('has the paste field, helper, tip and the two boxes, for both kinds', () => {
    for (const fishing of [true, false]) {
      const html = render(fishing)
      expect(html).toContain('placeholder="40.127, -111.020"')
      expect(html).toContain(PASTE_HELP)
      expect(html).toContain(coordinatesTip(fishing))
      expect(html).toContain('Latitude')
      expect(html).toContain('Longitude')
      expect(html).not.toContain('onX')
    }
  })

  it('shows no unreadable message before anything is pasted', () => {
    expect(render(false)).not.toContain('read those coordinates')
  })

  it('controls are 44 px or taller and nothing uses alpha backgrounds', () => {
    const html = render(false)
    for (const cls of classAttrs(html)) expect(cls).not.toMatch(/\/\d+/)
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/min-h-\[44px\]/)
  })
})

describe('Save with empty or invalid coordinates', () => {
  const values = (lat: string, lon: string) => ({ name: 'Upper', lat, lon })

  it('shows the coordinate message and does not call the server when both boxes are empty', async () => {
    const onSubmit = vi.fn(async () => null)
    expect(await submitSpotForm(values('', ''), onSubmit)).toBe(COORDINATE_MESSAGE)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does the same for one empty box, spaces only, 0 and 0, text, and out-of-range values', async () => {
    const onSubmit = vi.fn(async () => null)
    for (const [lat, lon] of [['40.1', ''], ['', '-111.0'], [' ', ' '], ['0', '0'], ['abc', '-111'], ['91', '-111'], ['40', '-181']]) {
      expect(await submitSpotForm(values(lat, lon), onSubmit), `${lat} / ${lon}`).toBe(COORDINATE_MESSAGE)
    }
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('sends valid coordinates through, and returns whatever the server says', async () => {
    const ok = vi.fn(async () => null)
    expect(await submitSpotForm(values('40.127361', '-111.020472'), ok)).toBeNull()
    expect(ok).toHaveBeenCalledWith(values('40.127361', '-111.020472'))

    const refused = vi.fn(async () => 'Spot limit reached.')
    expect(await submitSpotForm(values('40.1', '-111.0'), refused)).toBe('Spot limit reached.')
  })
})
