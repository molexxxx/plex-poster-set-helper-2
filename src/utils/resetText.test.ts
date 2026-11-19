import { describe, it, expect, afterEach, vi } from 'vitest'
import type { AppliedRecord } from '../../electron/ipc/types'
import { cleanLabel, enlarge, filterTracked, latestPerItem, timeAgo, trackedStats } from '../features/reset/resetText'

function record(itemKey: string, over: Partial<AppliedRecord> = {}): AppliedRecord
{
  return { itemKey, title: `Title ${itemKey}`, type: 'movie', source: 'mediux', posterUrls: [], appliedAt: '2026-11-01T00:00:00Z', ...over }
}

afterEach(() =>
{
  vi.useRealTimers()
})

describe('reset list helpers', () =>
{
  it('asks for a bigger thumbnail for the lightbox', () =>
  {
    expect(enlarge('/photo/:/transcode?width=240&height=360&url=x')).toBe('/photo/:/transcode?width=700&height=1050&url=x')
    expect(enlarge(undefined)).toBeUndefined()
  })

  it('says how long ago art was applied', () =>
  {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    expect(timeAgo('2026-11-19T11:59:30Z')).toBe('just now')
    expect(timeAgo('2026-11-19T11:15:00Z')).toBe('45m ago')
    expect(timeAgo('2026-11-19T02:00:00Z')).toBe('10h ago')
    expect(timeAgo('2026-11-09T12:00:00Z')).toBe('10d ago')
    expect(timeAgo('2026-08-19T12:00:00Z')).toBe('3mo ago')
    expect(timeAgo('2024-11-01T12:00:00Z')).toBe('2y ago')
    expect(timeAgo(undefined)).toBe('')
  })

  it('keeps the first record for each item', () =>
  {
    const rows = latestPerItem([record('1', { setId: 'new' }), record('2'), record('1', { setId: 'old' })])
    expect(rows.map(r => [r.key, r.setId])).toEqual([['1', 'new'], ['2', undefined]])
  })

  it('filters by source, type, and title', () =>
  {
    const rows = latestPerItem([
      record('1', { title: 'Dune', source: 'mediux', type: 'movie' }),
      record('2', { title: 'Severance', source: 'mediux', type: 'show' }),
      record('3', { title: 'Sicario', source: 'posterdb', type: 'movie' }),
    ])
    expect(filterTracked(rows, 'all', 'all', '').map(r => r.key)).toEqual(['1', '2', '3'])
    expect(filterTracked(rows, 'mediux', 'all', '').map(r => r.key)).toEqual(['1', '2'])
    expect(filterTracked(rows, 'all', 'movie', '').map(r => r.key)).toEqual(['1', '3'])
    expect(filterTracked(rows, 'all', 'all', 'SEV').map(r => r.key)).toEqual(['2'])
    expect(filterTracked(rows, 'posterdb', 'show', '')).toEqual([])
  })

  it('counts items by source and type', () =>
  {
    const rows = latestPerItem([
      record('1', { source: 'mediux', type: 'movie' }),
      record('2', { source: 'mediux', type: 'show' }),
      record('3', { source: 'posterdb', type: 'collection' }),
    ])
    expect(trackedStats(rows)).toEqual({ total: 3, mediux: 2, posterdb: 1, movies: 1, shows: 1 })
  })

  it('labels the Clean Bundles button for each state', () =>
  {
    expect([cleanLabel('idle'), cleanLabel('cleaning'), cleanLabel('done'), cleanLabel('error')])
      .toEqual(['Clean Bundles', 'Cleaning…', 'Cleaned', 'Failed'])
  })
})
