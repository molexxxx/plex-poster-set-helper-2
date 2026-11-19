import { describe, it, expect, vi, afterEach } from 'vitest'
import { toArtFilter } from '../features/library/browser/gridOptions'
import { clampPanelWidth, hiResArt, matchCollectionChild, sourceFailure, PANEL_WIDTH_DEFAULT } from '../features/library/sets/setsPanelUtils'
import { browseCacheKey, currentArtCache, staleCurrentArt } from '../features/library/sets/setsCache'
import type { LibraryItem, PosterInfo } from '../../electron/ipc/types'

describe('toArtFilter', () =>
{
  it('sends no filter for all titles', () =>
  {
    expect(toArtFilter('all')).toBeUndefined()
  })

  it('maps the history filters to their kind', () =>
  {
    expect(toArtFilter('none')).toEqual({ kind: 'none' })
    expect(toArtFilter('applied')).toEqual({ kind: 'applied' })
    expect(toArtFilter('unscheduled')).toEqual({ kind: 'unscheduled' })
  })

  it('keeps the site and the whole name of an uploader filter', () =>
  {
    expect(toArtFilter('uploader:mediux:willtong93')).toEqual({ kind: 'uploader', uploader: 'willtong93', source: 'mediux' })
    expect(toArtFilter('uploader:posterdb:name:with:colons')).toEqual({ kind: 'uploader', uploader: 'name:with:colons', source: 'posterdb' })
    expect(toArtFilter('uploader:elsewhere:someone' as Parameters<typeof toArtFilter>[0])).toBeUndefined()
  })
})

describe('sourceFailure', () =>
{
  it('reports the site error the answer names', () =>
  {
    expect(sourceFailure('mediux', { sets: [], sourceErrors: { mediux: 'timed out' } })).toBe('timed out')
    expect(sourceFailure('posterdb', { sets: [], sourceErrors: { mediux: 'timed out' } })).toBeUndefined()
  })

  it('treats a general error as the site failing, except the title notices', () =>
  {
    expect(sourceFailure('mediux', { sets: [], error: 'offline' })).toBe('offline')
    expect(sourceFailure('mediux', { sets: [], error: 'no_tmdb' })).toBeUndefined()
    expect(sourceFailure('mediux', { sets: [], error: 'no_movies' })).toBeUndefined()
    expect(sourceFailure('mediux', { sets: [] })).toBeUndefined()
  })
})

describe('hiResArt', () =>
{
  it('asks Plex for a larger transcode', () =>
  {
    expect(hiResArt('http://192.168.1.20:32400/photo/:/transcode?width=240&height=360&minSize=1&url=%2Flibrary%2Fmetadata%2F1%2Fthumb'))
      .toBe('http://192.168.1.20:32400/photo/:/transcode?width=800&height=1200&minSize=1&url=%2Flibrary%2Fmetadata%2F1%2Fthumb')
  })

  it('rewrites the web UI photo proxy the same way', () =>
  {
    expect(hiResArt('/api/plex/photo?width=240&height=360&url=%2Flibrary%2Fmetadata%2F1%2Fthumb'))
      .toBe('/api/plex/photo?width=800&height=1200&url=%2Flibrary%2Fmetadata%2F1%2Fthumb')
  })

  it('leaves a URL without transcode dimensions alone', () =>
  {
    expect(hiResArt('https://example.com/poster.jpg')).toBe('https://example.com/poster.jpg')
  })
})

describe('matchCollectionChild', () =>
{
  const children: LibraryItem[] = [
    { key: '1', title: 'Dune', year: 2021, type: 'movie', tmdbId: '438631' },
    { key: '2', title: 'Dune: Part Two', year: 2024, type: 'movie' },
  ]
  const poster = (extra: Partial<PosterInfo>): PosterInfo => ({ title: '', url: 'u', source: 'mediux', ...extra })

  it('matches by TMDB id first', () =>
  {
    expect(matchCollectionChild(poster({ title: 'Something else', tmdbId: '438631' }), children)?.key).toBe('1')
  })

  it('falls back to the title, and the year when both sides have one', () =>
  {
    expect(matchCollectionChild(poster({ title: ' dune: part two ', year: 2024 }), children)?.key).toBe('2')
    expect(matchCollectionChild(poster({ title: 'Dune: Part Two' }), children)?.key).toBe('2')
    expect(matchCollectionChild(poster({ title: 'Dune: Part Two', year: 2023 }), children)).toBeUndefined()
    expect(matchCollectionChild(poster({ title: 'Arrival', tmdbId: '329865' }), children)).toBeUndefined()
  })
})

describe('clampPanelWidth', () =>
{
  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  it('keeps the width between the minimum and the maximum', () =>
  {
    vi.stubGlobal('window', { innerWidth: 1920 })
    expect(clampPanelWidth(PANEL_WIDTH_DEFAULT)).toBe(PANEL_WIDTH_DEFAULT)
    expect(clampPanelWidth(100)).toBe(360)
    expect(clampPanelWidth(5000)).toBe(900)
  })

  it('stays within 90 percent of a narrow window', () =>
  {
    vi.stubGlobal('window', { innerWidth: 600 })
    expect(clampPanelWidth(800)).toBe(540)
  })
})

describe('sets panel caches', () =>
{
  it('keys collections and each type of title apart', () =>
  {
    expect(browseCacheKey({ key: '7', title: 'A', type: 'collection' })).toBe('collection:7')
    expect(browseCacheKey({ key: '7', title: 'A', type: 'movie' })).toBe('sets:movie:7')
    expect(browseCacheKey({ key: '7', title: 'A', type: 'show' })).toBe('sets:show:7')
  })

  it('marks cached art stale while keeping it to show', () =>
  {
    currentArtCache.set('art-1', { slots: [{ key: 'art-1', label: 'A', kind: 'movie' }], fetchedAt: 12345 })
    staleCurrentArt('art-1')
    expect(currentArtCache.get('art-1')).toEqual({ slots: [{ key: 'art-1', label: 'A', kind: 'movie' }], fetchedAt: 0 })
    staleCurrentArt('missing')
    expect(currentArtCache.has('missing')).toBe(false)
  })
})
