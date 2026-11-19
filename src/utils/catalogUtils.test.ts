import { describe, it, expect } from 'vitest'
import { appendNew, count, fileCaption, groupByTitle, plural, shortTypeCounts, titleKey } from '../features/library/creators/catalogUtils'
import { CATALOG_CACHE_LIMIT, catalogCache, rememberCatalog, type CachedCatalog } from '../features/library/creators/catalogCache'
import type { MediuxUserSet, PosterInfo } from '../../electron/ipc/types'

function set(id: string, title: string, extra: Partial<MediuxUserSet> = {}): MediuxUserSet
{
  return {
    id, source: 'mediux', setName: `${title} set`, uploader: 'someone', title,
    posterCount: 1, backdropCount: 0, titleCardCount: 0, posters: [], ...extra,
  }
}

function file(extra: Partial<PosterInfo>): PosterInfo
{
  return { title: 'Show', url: 'https://example.com/a.jpg', source: 'mediux', ...extra }
}

describe('count and plural', () =>
{
  it('formats counts with thousands separators', () =>
  {
    expect(count(1234567)).toBe('1,234,567')
    expect(count(7)).toBe('7')
  })

  it('picks the noun for the count', () =>
  {
    expect(plural(1, 'set')).toBe('1 set')
    expect(plural(0, 'set')).toBe('0 sets')
    expect(plural(1200, 'title card')).toBe('1,200 title cards')
    expect(plural(2, 'person', 'people')).toBe('2 people')
  })
})

describe('titleKey', () =>
{
  it('keys a matched set by its Plex item', () =>
  {
    expect(titleKey(set('1', 'Dune', { matchedKey: '42', year: 2021 }))).toBe('k:42')
  })

  it('keys an unmatched set by its normalized title and year', () =>
  {
    expect(titleKey(set('1', 'Blade Runner: 2049!', { year: 2017 }))).toBe('t:blade runner 2049|2017')
    expect(titleKey(set('1', 'Heat'))).toBe('t:heat|')
  })
})

describe('groupByTitle', () =>
{
  it('groups sets for the same title in catalog order', () =>
  {
    const groups = groupByTitle([
      set('1', 'Dune', { matchedKey: '42', year: 2021 }),
      set('2', 'Heat', { year: 1995 }),
      set('3', 'Dune (2021)', { matchedKey: '42', year: 2021 }),
      set('4', 'heat', { year: 1995 }),
    ])
    expect(groups.map(g => g.key)).toEqual(['k:42', 't:heat|1995'])
    expect(groups[0].sets.map(s => s.id)).toEqual(['1', '3'])
    expect(groups[0]).toMatchObject({ title: 'Dune', year: 2021, matchedKey: '42' })
    expect(groups[1].sets.map(s => s.id)).toEqual(['2', '4'])
  })
})

describe('appendNew', () =>
{
  it('appends only the sets the list does not hold', () =>
  {
    const prev = [set('1', 'A'), set('2', 'B')]
    expect(appendNew(prev, [set('2', 'B'), set('3', 'C')]).map(s => s.id)).toEqual(['1', '2', '3'])
  })

  it('returns the same list when nothing is new', () =>
  {
    const prev = [set('1', 'A')]
    expect(appendNew(prev, [])).toBe(prev)
    expect(appendNew(prev, [set('1', 'A')])).toBe(prev)
  })
})

describe('shortTypeCounts', () =>
{
  it('lists the file types a set holds', () =>
  {
    expect(shortTypeCounts(set('1', 'A', { posterCount: 3, titleCardCount: 12, backdropCount: 1 }))).toBe('3 posters · 12 title cards · 1 backdrop')
    expect(shortTypeCounts(set('1', 'A', { posterCount: 1 }))).toBe('1 poster')
    expect(shortTypeCounts(set('1', 'A', { posterCount: 0 }))).toBe('No files')
  })
})

describe('fileCaption', () =>
{
  it('names episodes and seasons', () =>
  {
    expect(fileCaption(file({ season: 1, episode: 3 }))).toBe('Season 1, Episode 3')
    expect(fileCaption(file({ season: 'Cover', episode: 2 }))).toBe('Episode 2')
    expect(fileCaption(file({ season: 2 }))).toBe('Season 2')
    expect(fileCaption(file({ season: 0 }))).toBe('Specials')
  })

  it('leaves posters and backdrops without a caption', () =>
  {
    expect(fileCaption(file({}))).toBeUndefined()
    expect(fileCaption(file({ season: 'Backdrop' }))).toBeUndefined()
  })
})

describe('rememberCatalog', () =>
{
  const entry = (rev: number): CachedCatalog => ({ rev, sets: [], capped: false, fetchedAt: 0, status: 'done' })

  it('keeps the newest catalogs up to the limit, refreshing one that is stored again', () =>
  {
    catalogCache.clear()
    const names = Array.from({ length: CATALOG_CACHE_LIMIT + 1 }, (_, i) => `creator${i}`)
    for (const name of names.slice(0, CATALOG_CACHE_LIMIT)) rememberCatalog(name, entry(1))
    rememberCatalog(names[0], entry(2))
    rememberCatalog(names[CATALOG_CACHE_LIMIT], entry(1))
    expect(catalogCache.size).toBe(CATALOG_CACHE_LIMIT)
    expect(catalogCache.has(names[1])).toBe(false)
    expect(catalogCache.get(names[0])?.rev).toBe(2)
    expect([...catalogCache.keys()].pop()).toBe(names[CATALOG_CACHE_LIMIT])
  })
})
