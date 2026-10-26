import { describe, it, expect, vi } from 'vitest'
import type { PosterSetSummary } from '../../electron/ipc/types'
import type { MediuxSet } from '../../electron/scrapers/mediuxScraper'

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({ mediuxFilters: ['poster', 'backdrop', 'title_card'] }) },
}))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

const { keepDownloads, rankByDownloads, setDownloads } = await import('../../electron/scrapers/mediuxScraper')

function summary(uploader: string, downloads?: number): PosterSetSummary
{
  return { id: uploader, source: 'mediux', setName: `Set ${uploader}`, uploader, posterCount: 1, backdropCount: 0, titleCardCount: 0, posters: [], downloads }
}

describe('setDownloads', () =>
{
  it('sums the counts on the files, numeric or string', () =>
  {
    const set: MediuxSet = { id: 1, files: [
      { id: 'a', fileType: 'poster', downloads_func: { count: 56 } },
      { id: 'b', fileType: 'backdrop', downloads_func: { count: '12' } },
      { id: 'c', fileType: 'poster' },
    ] }
    expect(setDownloads(set)).toBe(68)
  })

  it('gives no total when no file carries a count, as on collection pages', () =>
  {
    const set: MediuxSet = { id: 2, files: [
      { id: 'a', fileType: 'poster' },
      { id: 'b', fileType: 'poster', downloads_func: null },
    ] }
    expect(setDownloads(set)).toBeUndefined()
    expect(setDownloads({ id: 3 })).toBeUndefined()
  })

  it('keeps a real 0 when the page reports one', () =>
  {
    expect(setDownloads({ id: 4, files: [{ id: 'a', fileType: 'poster', downloads_func: { count: 0 } }] })).toBe(0)
  })
})

describe('rankByDownloads', () =>
{
  it('ranks by downloads, page order breaking ties, without reordering the list', () =>
  {
    const out = rankByDownloads([summary('alice', 3), summary('bob', 12), summary('carol', 3), summary('dave')])
    expect(out.map(s => s.uploader)).toEqual(['alice', 'bob', 'carol', 'dave'])
    expect(out.map(s => s.popularityRank)).toEqual([1, 0, 2, 3])
  })
})

describe('keepDownloads', () =>
{
  it("copies the browse page's counts onto a set re-read from its own page, by file id", () =>
  {
    const original: MediuxSet = { id: 7, files: [
      { id: 'a', fileType: 'poster', downloads_func: { count: 56 } },
      { id: 'b', fileType: 'poster', downloads_func: { count: 49 } },
    ] }
    const full: MediuxSet = { id: 7, files: [
      { id: 'b', fileType: 'poster', movie_id: { id: '2' } },
      { id: 'a', fileType: 'poster' },
      { id: 'c', fileType: 'poster' },
    ] }
    const out = keepDownloads(full, original)
    expect(out.files?.map(f => f.downloads_func?.count)).toEqual([49, 56, undefined])
    expect(out.files?.[0].movie_id).toEqual({ id: '2' })
    expect(setDownloads(out)).toBe(105)
  })
})
