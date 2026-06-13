import { describe, it, expect } from 'vitest'
import { posterFileType, groupPosters, ALL_TYPES } from './posterGroups'
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
