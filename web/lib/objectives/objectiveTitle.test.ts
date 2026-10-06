import { describe, it, expect } from 'vitest'
import { buildObjectiveTitle, isRawKeyTitle, resolveObjectiveTitle } from './objectiveTitle'

describe('buildObjectiveTitle', () => {
  it('fishing without a state: species, then method', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'salmon.sockeye.river_migration' })).toBe('Sockeye salmon, river migration')
    expect(buildObjectiveTitle({ taxonomyKey: 'salmon.king.river_migration' })).toBe('King salmon, river migration')
  })

  it('fishing with a state: the full state name in parentheses', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'trout.rainbow.fly_fishing', state: 'UT' })).toBe('Rainbow trout, fly fishing (Utah)')
  })

  it('fishing with a water body: it follows the method', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'trout.brown.fly_fishing', state: 'ut', waterBody: '  Green   River ' }))
      .toBe('Brown trout, fly fishing, Green River (Utah)')
  })

  it('elk with a hunt code: code first, antlerless for a cow, no method', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.cow.archery', state: 'UT', huntCode: 'EA2004' })).toBe('EA2004 antlerless elk (Utah)')
  })

  it('elk with a hunt code is upper-cased and trimmed', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.bull.rifle', state: 'UT', huntCode: ' eb3000 ' })).toBe('EB3000 bull elk (Utah)')
  })

  it('elk without a hunt code keeps the method', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.bull.archery', state: 'UT' })).toBe('Bull elk, archery (Utah)')
  })

  it('deer varieties read as "mule deer" and "whitetail deer"', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'deer.mule.archery' })).toBe('Mule deer, archery')
    expect(buildObjectiveTitle({ taxonomyKey: 'deer.whitetail.rifle', state: 'MT' })).toBe('Whitetail deer, rifle (Montana)')
  })

  it('a missing state adds no suffix, and an empty or unknown state code is dropped', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.bull.archery', state: null })).toBe('Bull elk, archery')
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.bull.archery', state: '' })).toBe('Bull elk, archery')
    expect(buildObjectiveTitle({ taxonomyKey: 'elk.bull.archery', state: 'ZZ' })).toBe('Bull elk, archery')
  })

  it('an unknown taxonomy falls back to a cleaned key, not a reordered one', () => {
    expect(buildObjectiveTitle({ taxonomyKey: 'mountain_goat.billy.rifle', state: 'ID' })).toBe('Mountain goat billy rifle (Idaho)')
  })

  it('an empty taxonomy is still a title', () => {
    expect(buildObjectiveTitle({ taxonomyKey: '' })).toBe('Objective')
    expect(buildObjectiveTitle({ taxonomyKey: null, state: 'UT' })).toBe('Objective (Utah)')
  })

  it('never puts a coordinate in a title, even when the water body field holds one', () => {
    const title = buildObjectiveTitle({ taxonomyKey: 'trout.rainbow.fly_fishing', state: 'UT', waterBody: '40.5123, -111.2456' })
    expect(title).toBe('Rainbow trout, fly fishing (Utah)')
    expect(title).not.toMatch(/\d\.\d/)
  })

  it('caps a long water body', () => {
    const title = buildObjectiveTitle({ taxonomyKey: 'trout.rainbow.fly_fishing', waterBody: 'x'.repeat(200) })
    expect(title.length).toBeLessThan(120)
  })
})

describe('isRawKeyTitle', () => {
  it('recognises the pre-FF-095 raw key title, with or without a hunt number', () => {
    expect(isRawKeyTitle('salmon · sockeye · river_migration', 'salmon.sockeye.river_migration')).toBe(true)
    expect(isRawKeyTitle('elk · bull · archery · EA2004', 'elk.bull.archery', 'EA2004')).toBe(true)
    expect(isRawKeyTitle('', 'elk.bull.archery')).toBe(true)
    expect(isRawKeyTitle(null, 'elk.bull.archery')).toBe(true)
  })

  it('does not call a written title raw', () => {
    expect(isRawKeyTitle('Fall elk, Unit 5A', 'elk.bull.archery')).toBe(false)
  })
})

describe('resolveObjectiveTitle', () => {
  it('keeps a stored title that is not just the raw key', () => {
    expect(resolveObjectiveTitle({ storedTitle: 'Fall elk, Unit 5A', taxonomyKey: 'elk.bull.archery', state: 'UT' })).toBe('Fall elk, Unit 5A')
  })

  it('computes a title when the stored one is the raw key', () => {
    expect(resolveObjectiveTitle({
      storedTitle: 'salmon · sockeye · river_migration',
      taxonomyKey: 'salmon.sockeye.river_migration',
    })).toBe('Sockeye salmon, river migration')
  })

  it('computes a title when there is no stored title', () => {
    expect(resolveObjectiveTitle({ storedTitle: null, taxonomyKey: 'elk.cow.archery', state: 'UT', huntCode: 'EA2004' })).toBe('EA2004 antlerless elk (Utah)')
  })
})
