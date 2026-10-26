import { describe, it, expect } from 'vitest'
import type { PosterInfo, PosterSetSummary, SetSource } from '../../electron/ipc/types'
import { ALL_TYPES, type FileType } from './posterGroups'
import { arrangeSets, byPopularity, uploaderValue } from './librarySets'
import type { CreatorState } from './creatorPrefs'

function poster(extra: Partial<PosterInfo> = {}): PosterInfo
{
  return { url: 'https://example.com/p.jpg', source: 'mediux', title: 'Title', ...extra }
}

function set(id: string, source: SetSource, uploader: string, posters: PosterInfo[]): PosterSetSummary
{
  return { id, source, setName: `Set ${id}`, uploader, posterCount: posters.length, backdropCount: 0, titleCardCount: 0, posters }
}

const alice = set('1', 'mediux', 'alice', [poster()])
const bob = set('2', 'mediux', 'bob', [poster()])
const carol = set('3', 'posterdb', 'carol', [poster({ source: 'posterdb' })])
const dave = set('4', 'posterdb', 'dave', [poster({ source: 'posterdb', season: 'Backdrop' })])
const sets = [alice, bob, carol, dave]

const states: Record<string, CreatorState> = { 'mediux:alice': 'followed', 'posterdb:carol': 'hidden' }
const stateOf = (source: SetSource, name: string): CreatorState => states[`${source}:${name}`] ?? 'none'

function options(overrides: Partial<Parameters<typeof arrangeSets>[1]> = {})
{
  return { source: 'all' as const, uploader: 'all', types: new Set<FileType>(ALL_TYPES), showHidden: false, stateOf, ...overrides }
}

describe('arrangeSets', () =>
{
  it('puts followed creators first, keeps hidden ones back, and counts them', () =>
  {
    const out = arrangeSets(sets, options())
    expect(out.visibleSets.map(s => s.id)).toEqual(['1', '2', '4'])
    expect(out.hiddenCount).toBe(1)
    expect(out.uploaders.map(u => u.value)).toEqual(['mediux:alice', 'mediux:bob', 'posterdb:dave'])
    expect(out.uploaders.map(u => u.label)).toEqual(['alice', 'bob', 'dave'])
    expect(out.sourceCounts).toEqual({ mediux: 2, posterdb: 2 })
    expect(sets.map(s => s.id)).toEqual(['1', '2', '3', '4'])
  })

  it('reveals hidden sets last and lists their creators after the others', () =>
  {
    const out = arrangeSets(sets, options({ showHidden: true }))
    expect(out.visibleSets.map(s => s.id)).toEqual(['1', '2', '4', '3'])
    expect(out.hiddenCount).toBe(1)
    expect(out.uploaders.map(u => u.value)).toEqual(['mediux:alice', 'mediux:bob', 'posterdb:dave', 'posterdb:carol'])
  })

  it('counts hidden sets only among those the type chips allow', () =>
  {
    const out = arrangeSets(sets, options({ types: new Set<FileType>(['backdrop']) }))
    expect(out.visibleSets.map(s => s.id)).toEqual(['4'])
    expect(out.hiddenCount).toBe(0)
  })

  it('drops an uploader choice that the chosen site does not have', () =>
  {
    const out = arrangeSets(sets, options({ source: 'posterdb', uploader: 'mediux:bob' }))
    expect(out.activeUploader).toBe('all')
    expect(out.visibleSets.map(s => s.id)).toEqual(['4'])
    expect(out.uploaders.map(u => u.value)).toEqual(['posterdb:dave'])
    expect(out.sourceCounts).toEqual({ mediux: 2, posterdb: 2 })
  })

  it('falls back to every site when the chosen one returned nothing', () =>
  {
    const out = arrangeSets([alice, bob], options({ source: 'posterdb' }))
    expect(out.activeSource).toBe('all')
    expect(out.visibleSets.map(s => s.id)).toEqual(['1', '2'])
  })

  it('drops an uploader choice once that creator is hidden', () =>
  {
    const out = arrangeSets(sets, options({ uploader: 'posterdb:carol' }))
    expect(out.activeUploader).toBe('all')
    expect(out.visibleSets.map(s => s.id)).toEqual(['1', '2', '4'])
  })

  it('tells the same name on two sites apart', () =>
  {
    const twin = set('5', 'posterdb', 'Alice', [poster({ source: 'posterdb' })])
    const out = arrangeSets([alice, twin, bob], options())
    expect(out.uploaders.map(u => u.label)).toEqual(['alice · MediUX', 'Alice · TPDb', 'bob'])
    const narrowed = arrangeSets([alice, twin, bob], options({ uploader: uploaderValue(twin) }))
    expect(narrowed.visibleSets.map(s => s.id)).toEqual(['5'])
  })

  it('narrows the list to one uploader', () =>
  {
    const out = arrangeSets(sets, options({ uploader: 'mediux:bob' }))
    expect(out.activeUploader).toBe('mediux:bob')
    expect(out.visibleSets.map(s => s.id)).toEqual(['2'])
    expect(out.hiddenCount).toBe(0)
  })
})

describe('byPopularity', () =>
{
  const ranked = (s: PosterSetSummary, popularityRank?: number): PosterSetSummary => ({ ...s, popularityRank })

  it('puts the most downloaded first within a source, not the alphabetical first', () =>
  {
    const order = [ranked(alice, 1), ranked(bob, 0)].sort(byPopularity)
    expect(order.map(s => s.uploader)).toEqual(['bob', 'alice'])
  })

  it('alternates the sources rank by rank, MediUX first on a tie', () =>
  {
    const order = [ranked(dave, 0), ranked(carol, 1), ranked(alice, 1), ranked(bob, 0)].sort(byPopularity)
    expect(order.map(s => s.uploader)).toEqual(['bob', 'dave', 'alice', 'carol'])
  })

  it('keeps unranked sets after ranked ones, alphabetical among themselves', () =>
  {
    const order = [ranked(bob), ranked(dave, 3), ranked(alice)].sort(byPopularity)
    expect(order.map(s => s.uploader)).toEqual(['dave', 'alice', 'bob'])
  })

  it('keeps followed creators first when the panel arranges ranked sets', () =>
  {
    const order = [ranked(bob, 0), ranked(alice, 1)].sort(byPopularity)
    const out = arrangeSets(order, options())
    expect(out.visibleSets.map(s => s.uploader)).toEqual(['alice', 'bob'])
  })
})
