import { describe, it, expect } from 'vitest'
import { resolveMovebankTaxon, parseCsv } from './movebankCollarFetch'

describe('resolveMovebankTaxon (Fix 5 — single source of truth for species keys)', () => {
  it('resolves a fully-qualified elk taxonomy key', () => {
    expect(resolveMovebankTaxon('elk.bull.archery.HD316')).toEqual({
      scientificName: 'Cervus canadensis',
      speciesTaxonKey: 'elk.bull',
    })
  })

  it('resolves mule deer', () => {
    expect(resolveMovebankTaxon('deer.mule.archery')).toEqual({
      scientificName: 'Odocoileus hemionus',
      speciesTaxonKey: 'deer.mule',
    })
  })

  it('resolves single-segment species keys (moose, caribou, pronghorn)', () => {
    // These species have no sub-segment in their taxonomy_key, unlike elk/deer —
    // the old fallback (first two dot-segments) broke on 'moose.bull.x'.
    expect(resolveMovebankTaxon('moose.bull.x')).toEqual({
      scientificName: 'Alces alces',
      speciesTaxonKey: 'moose',
    })
    expect(resolveMovebankTaxon('caribou')).toEqual({
      scientificName: 'Rangifer tarandus',
      speciesTaxonKey: 'caribou',
    })
    expect(resolveMovebankTaxon('pronghorn')).toEqual({
      scientificName: 'Antilocapra americana',
      speciesTaxonKey: 'pronghorn',
    })
  })

  it('returns null for salmon (removed from this agent\'s scope — not GPS-collared)', () => {
    expect(resolveMovebankTaxon('salmon.king.river_migration')).toBeNull()
  })

  it('returns null for an unrecognized taxonomy key', () => {
    expect(resolveMovebankTaxon('trout.rainbow.fly_fishing')).toBeNull()
  })
})

describe('parseCsv (Fix 6c — RFC 4180 parsing)', () => {
  it('splits a simple unquoted CSV', () => {
    const rows = parseCsv('id,name\n1,Elk Study\n2,Deer Study\n', 100)
    expect(rows).toEqual([
      { id: '1', name: 'Elk Study' },
      { id: '2', name: 'Deer Study' },
    ])
  })

  it('handles quoted fields containing commas', () => {
    const csv = 'id,name,citation\n1,"Elk Study, Utah Herd","Smith, J. (2020). Elk movement."\n'
    const rows = parseCsv(csv, 100)
    expect(rows).toEqual([
      { id: '1', name: 'Elk Study, Utah Herd', citation: 'Smith, J. (2020). Elk movement.' },
    ])
  })

  it('handles escaped double-quotes inside quoted fields', () => {
    const csv = 'id,name\n1,"The ""Big Horn"" Study"\n'
    const rows = parseCsv(csv, 100)
    expect(rows).toEqual([{ id: '1', name: 'The "Big Horn" Study' }])
  })

  it('handles multi-value cells (Movebank taxon_ids/sensor_type_ids style)', () => {
    const csv = 'id,taxon_ids\n1,"Cervus canadensis,Odocoileus hemionus"\n'
    const rows = parseCsv(csv, 100)
    expect(rows[0].taxon_ids).toBe('Cervus canadensis,Odocoileus hemionus')
  })

  it('returns an empty array for a header-only or empty response', () => {
    expect(parseCsv('id,name\n', 100)).toEqual([])
    expect(parseCsv('', 100)).toEqual([])
  })
})
