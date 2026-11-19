import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PosterResult } from '../features/scrape/hooks/useScrapeStore'

const mocks = vi.hoisted(() => ({ recordAppliedQuietly: vi.fn(async () => {}) }))

vi.mock('./appliedTracker', () => ({
  recordAppliedQuietly: mocks.recordAppliedQuietly,
}))

const { sourceFromUrl, shortUrl, posterLabel, shortReason, parseUrlList } = await import('../features/scrape/queueText')
const { uploadPoster } = await import('../features/scrape/uploadPoster')
const { posterSlot } = await import('../../electron/services/schedule/appliedArt')

function poster(over: Partial<PosterResult> = {}): PosterResult
{
  return { title: 'Dune', year: 2021, url: 'https://cdn/dune.jpg', thumbUrl: 'https://cdn/dune-thumb.jpg', source: 'mediux', uploadStatus: 'idle', ...over }
}

describe('queue text helpers', () =>
{
  it('tells the source site from a URL', () =>
  {
    expect(sourceFromUrl('https://theposterdb.com/set/2')).toBe('posterdb')
    expect(sourceFromUrl('https://MEDIUX.pro/sets/1')).toBe('mediux')
    expect(sourceFromUrl('https://example.com/x')).toBeNull()
  })

  it('shortens a URL to its host and path', () =>
  {
    expect(shortUrl('https://www.theposterdb.com/set/2?page=3')).toBe('theposterdb.com/set/2')
    expect(shortUrl('not a url')).toBe('not a url')
  })

  it('labels posters by season, episode, or year', () =>
  {
    expect(posterLabel(poster({ season: 'Backdrop' }))).toBe('Dune - Backdrop')
    expect(posterLabel(poster({ season: 'Cover' }))).toBe('Dune - Cover')
    expect(posterLabel(poster({ season: 2 }))).toBe('Dune S2')
    expect(posterLabel(poster({ episode: 4 }))).toBe('Dune E4')
    expect(posterLabel(poster())).toBe('Dune (2021)')
    expect(posterLabel(poster({ year: undefined }))).toBe('Dune')
  })

  it('shortens upload errors to fit a thumbnail', () =>
  {
    expect(shortReason('Not connected to Plex')).toBe('Not connected')
    expect(shortReason('Plex 403 Forbidden')).toBe('Auth error (403)')
    expect(shortReason('Plex 404 Not Found')).toBe('Not found (404)')
    expect(shortReason('Download failed: connection reset by peer')).toBe('connection reset b')
    expect(shortReason('Something unexpected went wrong')).toBe('Something unexpect')
  })

  it('splits the queue box into URLs by line or comma', () =>
  {
    expect(parseUrlList(' https://a/1 \nhttps://a/2,https://a/3\n\n , ')).toEqual(['https://a/1', 'https://a/2', 'https://a/3'])
    expect(parseUrlList('   ')).toEqual([])
  })
})

describe('uploadPoster', () =>
{
  const plex = { findItem: vi.fn(), findCollection: vi.fn(), uploadPoster: vi.fn() }
  const patch = vi.fn()

  beforeEach(() =>
  {
    for (const fn of [plex.findItem, plex.findCollection, plex.uploadPoster, patch, mocks.recordAppliedQuietly]) fn.mockReset()
    vi.stubGlobal('window', { api: { plex } })
  })

  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  const statuses = () => patch.mock.calls.map(([, , p]) => p.uploadStatus)

  it('matches a title by TMDB id, uploads, and records it', async () =>
  {
    const p = poster({ tmdbId: '438631', season: 1 })
    plex.findItem.mockResolvedValue({ key: '42', title: 'Dune', year: 2021, type: 'movie', libraryTitle: 'Movies' })
    plex.uploadPoster.mockResolvedValue({ success: true })

    await uploadPoster('e1', p, patch, '77')

    expect(plex.findItem).toHaveBeenCalledWith('Dune', 2021, undefined, '438631')
    expect(plex.uploadPoster).toHaveBeenCalledWith('42', p.url, 'mediux', 1, undefined, undefined, 'Dune')
    expect(statuses()).toEqual(['matching', 'uploading', 'done'])
    expect(mocks.recordAppliedQuietly).toHaveBeenCalledWith(expect.objectContaining({
      itemKey: '42', type: 'movie', setId: '77', posterUrls: [p.url], slots: [posterSlot(p)], thumb: p.thumbUrl,
    }))
  })

  it('sends collection art to the Plex collection of the same name', async () =>
  {
    const p = poster({ title: 'Dune Collection', isCollection: true })
    plex.findCollection.mockResolvedValue({ key: 'c9', title: 'Dune Collection', libraryTitle: 'Movies' })
    plex.uploadPoster.mockResolvedValue({ success: true })

    await uploadPoster('e1', p, patch)

    expect(plex.findItem).not.toHaveBeenCalled()
    expect(plex.uploadPoster).toHaveBeenCalledWith('c9', p.url, 'mediux', undefined, undefined, true, 'Dune Collection')
    expect(mocks.recordAppliedQuietly).toHaveBeenCalledWith(expect.objectContaining({ itemKey: 'c9', type: 'collection' }))
    expect(statuses()).toEqual(['matching', 'uploading', 'done'])
  })

  it('marks a poster with no library match', async () =>
  {
    plex.findItem.mockResolvedValue(null)
    await uploadPoster('e1', poster(), patch)
    plex.findCollection.mockResolvedValue(null)
    await uploadPoster('e1', poster({ isCollection: true }), patch)

    expect(statuses()).toEqual(['matching', 'no_match', 'matching', 'no_match'])
    expect(plex.uploadPoster).not.toHaveBeenCalled()
  })

  it('keeps the reason a failed upload gives, and records nothing', async () =>
  {
    plex.findItem.mockResolvedValue({ key: '42', title: 'Dune', type: 'movie', libraryTitle: 'Movies' })
    plex.uploadPoster.mockResolvedValue({ success: false, error: 'Plex 403 Forbidden' })
    await uploadPoster('e1', poster(), patch)
    plex.findItem.mockRejectedValue(new Error('Not connected to Plex'))
    await uploadPoster('e1', poster(), patch)

    expect(patch.mock.calls.map(([, , p]) => [p.uploadStatus, p.uploadError])).toEqual([
      ['matching', undefined], ['uploading', undefined], ['error', 'Plex 403 Forbidden'],
      ['matching', undefined], ['error', 'Not connected to Plex'],
    ])
    expect(mocks.recordAppliedQuietly).not.toHaveBeenCalled()
  })
})
