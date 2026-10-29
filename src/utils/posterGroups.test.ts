import { describe, it, expect } from 'vitest'
import { posterFileType, groupPosters, setKey, ALL_TYPES, collectionName, variantKey, variantClusters, resolveVariants } from './posterGroups'
import type { PosterInfo } from '../../electron/ipc/types'

function p(overrides: Partial<PosterInfo> = {}): PosterInfo {
  return { url: 'https://example.com/img.jpg', source: 'mediux', title: 'Test', ...overrides }
}

describe('posterFileType', () => {
  it('classifies season=Backdrop as backdrop', () => {
    expect(posterFileType(p({ season: 'Backdrop' }))).toBe('backdrop')
  })

  it('classifies episode != null as title_card', () => {
    expect(posterFileType(p({ episode: 1, season: 1 }))).toBe('title_card')
    expect(posterFileType(p({ episode: 0 }))).toBe('title_card')
  })

  it('classifies show poster (no season, no episode) as poster', () => {
    expect(posterFileType(p())).toBe('poster')
  })

  it('classifies season poster (numeric season, no episode) as poster', () => {
    expect(posterFileType(p({ season: 2 }))).toBe('poster')
  })
})

describe('ALL_TYPES', () => {
  it('contains exactly the three filter categories', () => {
    expect(ALL_TYPES).toEqual(['poster', 'backdrop', 'title_card'])
  })
})

describe('mediuxFilters - applyPosters filter gate', () => {
  function filterPosters(posters: PosterInfo[], enabled: Set<string>) {
    return posters.filter(po => enabled.has(posterFileType(po)))
  }

  const posters: PosterInfo[] = [
    p({ url: 'show.jpg' }),
    p({ url: 'backdrop.jpg', season: 'Backdrop' }),
    p({ url: 'card.jpg', episode: 1, season: 1 }),
    p({ url: 'season.jpg', season: 3 }),
  ]

  it('passes all posters when all types enabled', () => {
    const enabled = new Set(['poster', 'backdrop', 'title_card'])
    expect(filterPosters(posters, enabled)).toHaveLength(4)
  })

  it('filters out backdrops when backdrop excluded', () => {
    const enabled = new Set(['poster', 'title_card'])
    const result = filterPosters(posters, enabled)
    expect(result.every(po => posterFileType(po) !== 'backdrop')).toBe(true)
    expect(result).toHaveLength(3)
  })

  it('filters out title cards when title_card excluded', () => {
    const enabled = new Set(['poster', 'backdrop'])
    const result = filterPosters(posters, enabled)
    expect(result.every(po => posterFileType(po) !== 'title_card')).toBe(true)
    expect(result).toHaveLength(3)
  })

  it('returns empty when no types enabled', () => {
    expect(filterPosters(posters, new Set())).toHaveLength(0)
  })

  it('returns only posters when only poster enabled', () => {
    const enabled = new Set(['poster'])
    const result = filterPosters(posters, enabled)
    expect(result).toHaveLength(2)
    expect(result.every(po => posterFileType(po) === 'poster')).toBe(true)
  })
})

describe('groupPosters', () => {
  it('puts show posters in a Main Poster group with kind=poster', () => {
    const groups = groupPosters([p({ url: 'show.jpg' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('poster')
    expect(groups[0].label).toBe('Main Poster')
  })

  it('separates backdrops into their own group', () => {
    const groups = groupPosters([p({ url: 'show.jpg' }), p({ url: 'bg.jpg', season: 'Backdrop' })])
    const backdropGroup = groups.find(g => g.kind === 'backdrop')
    expect(backdropGroup).toBeDefined()
    expect(backdropGroup!.posters).toHaveLength(1)
  })

  it('groups title cards by season', () => {
    const groups = groupPosters([
      p({ url: 's1e1.jpg', season: 1, episode: 1 }),
      p({ url: 's1e2.jpg', season: 1, episode: 2 }),
      p({ url: 's2e1.jpg', season: 2, episode: 1 }),
    ])
    const tcGroups = groups.filter(g => g.kind === 'title_card')
    expect(tcGroups).toHaveLength(2)
    expect(tcGroups[0].label).toBe('Season 1 Title Cards')
    expect(tcGroups[1].label).toBe('Season 2 Title Cards')
  })

  it('returns empty array for no posters', () => {
    expect(groupPosters([])).toEqual([])
  })
})

describe('setKey', () => {
  it('qualifies a set id with its site', () => {
    expect(setKey({ id: '42', source: 'mediux' })).toBe('mediux:42')
    expect(setKey({ id: '42', source: 'posterdb' })).not.toBe(setKey({ id: '42', source: 'mediux' }))
    expect(setKey({ source: 'mediux' })).toBe('mediux:')
  })
})

describe('variants: one poster per Plex slot', () => {
  const hp = p({ url: 'hp.jpg', title: 'Harry Potter Collection', isCollection: true })
  const fb = p({ url: 'fb.jpg', title: 'Fantastic Beasts Collection', isCollection: true })
  const both = p({ url: 'both.jpg', title: 'Wizarding World Collection', isCollection: true })
  const m1 = p({ url: 'm1.jpg', title: 'Fantastic Beasts', year: 2016, tmdbId: '259316', isCollectionMember: true })
  const m1b = p({ url: 'm1b.jpg', title: 'Fantastic Beasts', year: 2016, tmdbId: '259316', isCollectionMember: true })
  const m2 = p({ url: 'm2.jpg', title: 'Crimes of Grindelwald', year: 2018, tmdbId: '338952', isCollectionMember: true })

  it('folds collection names the way Plex and the sites differ', () => {
    expect(collectionName('The Harry Potter Collection')).toBe('harry potter')
    expect(collectionName('Harry Potter')).toBe('harry potter')
    expect(collectionName('Amélie: Collection')).toBe('amelie')
  })

  it('keys collection art to the viewed collection, or to its own name from a title', () => {
    expect(variantKey(hp, 'collection')).toBe('collection|poster')
    expect(variantKey(fb, 'collection')).toBe('collection|poster')
    expect(variantKey(hp, 'title')).toBe('collection:harry potter|poster')
    expect(variantKey(m1, 'title')).toBe('member:259316|poster')
    expect(variantKey(p({ season: 2 }), 'title')).toBe('self|s2')
    expect(variantKey(p({ season: 'Backdrop' }), 'title')).toBe('self|backdrop')
  })

  it('applies one collection poster from a collection view, the one named after it', () => {
    const out = resolveVariants([hp, fb, both, m1, m2], 'collection', {}, 'Fantastic Beasts')
    expect(out.map(x => x.url)).toEqual(['fb.jpg', 'm1.jpg', 'm2.jpg'])
  })

  it('falls back to the first poster and honors a pick that is still in the set', () => {
    expect(resolveVariants([hp, both], 'collection', {}, 'Fantastic Beasts').map(x => x.url)).toEqual(['hp.jpg'])
    expect(resolveVariants([hp, both], 'collection', { 'collection|poster': 'both.jpg' }, 'Fantastic Beasts').map(x => x.url)).toEqual(['both.jpg'])
    expect(resolveVariants([hp, both], 'collection', { 'collection|poster': 'gone.jpg' }).map(x => x.url)).toEqual(['hp.jpg'])
  })

  it('keeps every collection from a title view and one poster per member movie', () => {
    const out = resolveVariants([hp, fb, m1, m1b, m2], 'title')
    expect(out.map(x => x.url)).toEqual(['hp.jpg', 'fb.jpg', 'm1.jpg', 'm2.jpg'])
    expect([...variantClusters([m1, m1b, m2], 'title').values()].map(c => c.length)).toEqual([2, 1])
  })
})
