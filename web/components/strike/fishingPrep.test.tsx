// FF-096b: a fishing objective has no Hunt number card on Prep and no hunt number in the header.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StrikePrepPanel from './StrikePrepPanel'
import StrikeHeader from './StrikeHeader'
import { isFishingObjective } from '@/lib/strike/objectiveKind'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const base = {
  id: 'prof-1',
  objective_id: 'arc-1',
  timing: { trip_start: '2026-10-01', trip_end: '2026-10-31' },
  geo: { water_body: 'Green River' },
  // A stale hunt number on a fishing row must not surface anywhere.
  hunt_code: 'EA2004',
}

const fishing = { ...base, taxonomy_key: 'trout.rainbow.fly_fishing', domain: 'fishing' }
const hunting = { ...base, taxonomy_key: 'elk.bull.archery', domain: 'elk', geo: { unit: '5A' } }

const prep = (objective: Record<string, unknown>) =>
  renderToStaticMarkup(<StrikePrepPanel objective={objective} brief={null} title="Green River opener" note={null} />)

describe('isFishingObjective', () => {
  it('is true for the fishing domain or a fishing taxonomy key', () => {
    expect(isFishingObjective({ domain: 'fishing', taxonomy_key: 'whatever' })).toBe(true)
    expect(isFishingObjective({ domain: 'salmon', taxonomy_key: 'salmon.king.river_migration' })).toBe(true)
    expect(isFishingObjective({ taxonomy_key: 'trout.brown.fly_fishing' })).toBe(true)
  })

  it('is false for hunting, and for nothing', () => {
    expect(isFishingObjective({ domain: 'elk', taxonomy_key: 'elk.bull.archery' })).toBe(false)
    expect(isFishingObjective({})).toBe(false)
    expect(isFishingObjective(null)).toBe(false)
  })
})

describe('Prep tab', () => {
  it('a fishing objective has no Hunt number card, and no hunt number anywhere', () => {
    const html = prep(fishing)
    expect(html).not.toContain('Hunt number')
    expect(html).not.toContain('EA2004')
    expect(html).not.toContain('Utah DWR')
  })

  it('a fishing objective gets fishing spots and the regulations note', () => {
    const html = prep(fishing)
    expect(html).toContain('Loading fishing spots')
    expect(html).toContain('Check current regulations for this water before you fish')
    expect(html).not.toContain('Hunt spots')
  })

  it('the fishing domain alone is enough, whatever the taxonomy key', () => {
    const html = prep({ ...fishing, taxonomy_key: 'something.new' })
    expect(html).not.toContain('Hunt number')
    expect(html).toContain('Loading fishing spots')
  })

  it('still shows Objective details for a fishing objective', () => {
    expect(prep(fishing)).toContain('Objective details')
  })

  it('a hunting objective keeps the Hunt number card, hunt spots and the one-line rules note', () => {
    const html = prep(hunting)
    expect(html).toContain('Hunt number')
    expect(html).toContain('value="EA2004"')
    expect(html).toContain('Loading hunt spots')
    expect(html).toContain('Confirm your unit boundary and current rules before you hunt.')
    expect(html).not.toContain('Check current regulations')
  })
})

describe('header', () => {
  const header = (huntCode: string | null) => renderToStaticMarkup(
    <StrikeHeader title="Green River opener" huntCode={huntCode} taxonomyKey="trout.rainbow.fly_fishing" evaluation={null} hasBrief={false} brief={null} isOnline />,
  )

  it('shows the hunt number when one is passed, and not when it is null', () => {
    expect(header('EA2004')).toContain('EA2004')
    expect(header(null)).not.toContain('EA2004')
  })
})
