import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { MediuxUserSet } from '../../electron/ipc/types'

const dir = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const fs = require('fs') as typeof import('fs')
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pps-creator-cache-'))
})

vi.mock('../../electron/scrapers/scraperFactory', () => ({
  ScraperFactory: { browseMediuxUser: vi.fn(), browseMediuxUserAll: vi.fn() },
}))

vi.mock('../../electron/services/plexService', () => ({
  PlexService: { findInLibrary: vi.fn(async () => null) },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../electron/runtime/events', () => ({ appEvents: { emitEvent: vi.fn() } }))
vi.mock('../../electron/runtime/paths', () => ({ getUserDataPath: () => dir }))

const { CreatorSetsService, CREATOR_CACHE_VERSION } = await import('../../electron/services/creatorSetsService')
const { ScraperFactory } = await import('../../electron/scrapers/scraperFactory')

function userSet(id: string, dateUpdated: string): MediuxUserSet
{
  return {
    id, source: 'mediux', setName: `Set ${id}`, uploader: 'alice', posterCount: 1, backdropCount: 0, titleCardCount: 0,
    posters: [], title: `Show ${id}`, year: 2020, mediaType: 'show', dateUpdated,
  }
}

/** Makes the full crawl stream the given sets, then finish. */
function crawlReturns(sets: MediuxUserSet[])
{
  vi.mocked(ScraperFactory.browseMediuxUserAll).mockImplementation(async (_user, opts) =>
  {
    await opts?.onBatch?.(sets, { page: 1, done: false, capped: false })
    await opts?.onBatch?.([], { page: 1, done: true, capped: false })
    return { sets, capped: false }
  })
}

beforeEach(() =>
{
  vi.clearAllMocks()
  CreatorSetsService.clearDisk()
})

/** Reads the creator cache file as written. */
function readCache(): { version: number; creators: Record<string, { sets: MediuxUserSet[]; partial?: boolean; lastPage?: number }> }
{
  return JSON.parse(fs.readFileSync(path.join(dir, 'creator-sets.json'), 'utf-8'))
}

describe('CreatorSetsService.catalog', () =>
{
  it('waits for the full crawl of a creator it has not seen', async () =>
  {
    crawlReturns([userSet('1', 'd1'), userSet('2', 'd2')])

    const { sets, capped } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => s.id)).toEqual(['1', '2'])
    expect(capped).toBe(false)
    expect(ScraperFactory.browseMediuxUserAll).toHaveBeenCalledOnce()
  })

  it('resyncs a stale catalog and picks up sets the creator updated', async () =>
  {
    crawlReturns([userSet('1', 'd1'), userSet('2', 'd2')])
    await CreatorSetsService.catalog('Alice')

    // Page 1 carries an updated set and a brand-new one; page 2 only repeats
    // cached sets, so the walk stops there instead of reading the whole catalog.
    vi.mocked(ScraperFactory.browseMediuxUser).mockImplementation(async (_user, page) =>
    {
      if (page === 1) return [userSet('1', 'd1-updated'), userSet('2', 'd2'), userSet('3', 'd3')]
      if (page === 2) return [userSet('2', 'd2')]
      return []
    })

    const { sets } = await CreatorSetsService.catalog('Alice', 0)

    expect(ScraperFactory.browseMediuxUserAll).toHaveBeenCalledOnce()
    expect(vi.mocked(ScraperFactory.browseMediuxUser).mock.calls.map(c => c[1])).toEqual([1, 2])
    expect(sets.map(s => [s.id, s.dateUpdated])).toEqual([['1', 'd1-updated'], ['3', 'd3'], ['2', 'd2']])
  })

  it('serves a fresh catalog without touching the network', async () =>
  {
    crawlReturns([userSet('1', 'd1')])
    await CreatorSetsService.catalog('Alice')

    await CreatorSetsService.catalog('Alice')

    expect(ScraperFactory.browseMediuxUserAll).toHaveBeenCalledOnce()
    expect(ScraperFactory.browseMediuxUser).not.toHaveBeenCalled()
  })

  it('serves a catalog cached by this version from disk without crawling', async () =>
  {
    const cached = { username: 'Alice', sets: [userSet('cached', 'd0')], capped: false, fetchedAt: Date.now() }
    fs.writeFileSync(path.join(dir, 'creator-sets.json'), JSON.stringify({ version: CREATOR_CACHE_VERSION, creators: { alice: cached } }))

    const { sets } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => s.id)).toEqual(['cached'])
    expect(ScraperFactory.browseMediuxUserAll).not.toHaveBeenCalled()
  })

  it('fills in the site for sets cached before they carried one, without crawling', async () =>
  {
    const legacy = { ...userSet('legacy', 'd0'), source: undefined }
    const cached = { username: 'Alice', sets: [legacy, userSet('tagged', 'd1')], capped: false, fetchedAt: Date.now() }
    fs.writeFileSync(path.join(dir, 'creator-sets.json'), JSON.stringify({ version: CREATOR_CACHE_VERSION, creators: { alice: cached } }))

    const { sets } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => [s.id, s.source])).toEqual([['legacy', 'mediux'], ['tagged', 'mediux']])
    expect(ScraperFactory.browseMediuxUserAll).not.toHaveBeenCalled()
  })

  it('drops a catalog cached by an older version and crawls again', async () =>
  {
    const stale = { username: 'Alice', sets: [userSet('stale', 'd0')], capped: false, fetchedAt: Date.now() }
    fs.writeFileSync(path.join(dir, 'creator-sets.json'), JSON.stringify({ version: CREATOR_CACHE_VERSION - 1, creators: { alice: stale } }))
    crawlReturns([userSet('1', 'd1')])

    const { sets } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => s.id)).toEqual(['1'])
    expect(ScraperFactory.browseMediuxUserAll).toHaveBeenCalledOnce()
  })

  it('clearDisk removes the cache file and crawls again on next use', async () =>
  {
    crawlReturns([userSet('1', 'd1')])
    await CreatorSetsService.catalog('Alice')
    await vi.waitFor(() => expect(fs.existsSync(path.join(dir, 'creator-sets.json'))).toBe(true))

    CreatorSetsService.clearDisk()

    expect(fs.existsSync(path.join(dir, 'creator-sets.json'))).toBe(false)
    await CreatorSetsService.catalog('Alice')
    expect(ScraperFactory.browseMediuxUserAll).toHaveBeenCalledTimes(2)
  })

  it('rejects when the crawl fails', async () =>
  {
    vi.mocked(ScraperFactory.browseMediuxUserAll).mockRejectedValue(new Error("Could not load page 2 of @bob's sets: fetch failed"))

    await expect(CreatorSetsService.catalog('Bob')).rejects.toThrow("Could not load page 2 of @bob's sets: fetch failed")
  })
})

describe('CreatorSetsService crawl checkpoints', () =>
{
  it('resumes a crawl cut short by quitting from its last page after a relaunch', async () =>
  {
    vi.mocked(ScraperFactory.browseMediuxUserAll).mockImplementationOnce(async (_user, opts) =>
    {
      await opts?.onBatch?.([userSet('1', 'd1'), userSet('2', 'd2')], { page: 2, done: false, capped: false })
      return new Promise(() => {})
    })
    CreatorSetsService.start('Alice')
    await vi.waitFor(() => expect(CreatorSetsService.start('Alice').collected).toBe(2))

    CreatorSetsService.flush()
    expect(readCache().creators.alice).toMatchObject({ partial: true, lastPage: 2 })

    CreatorSetsService.clear()
    vi.mocked(ScraperFactory.browseMediuxUserAll).mockImplementationOnce(async (_user, opts) =>
    {
      await opts?.onBatch?.([userSet('3', 'd3')], { page: 3, done: false, capped: false })
      await opts?.onBatch?.([], { page: 3, done: true, capped: false })
      return { sets: [], capped: false }
    })

    const { sets } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => s.id)).toEqual(['1', '2', '3'])
    const resumed = vi.mocked(ScraperFactory.browseMediuxUserAll).mock.calls[1][1]
    expect(resumed?.startPage).toBe(2)
    expect([...(resumed?.seen ?? [])]).toEqual(['1', '2'])
  })

  it('resumes after a page fails instead of crawling from the first page again', async () =>
  {
    vi.mocked(ScraperFactory.browseMediuxUserAll).mockImplementationOnce(async (_user, opts) =>
    {
      await opts?.onBatch?.([userSet('1', 'd1')], { page: 2, done: false, capped: false })
      throw new Error('Could not load page 3')
    })
    await expect(CreatorSetsService.catalog('Alice')).rejects.toThrow('Could not load page 3')

    CreatorSetsService.flush()
    expect(readCache().creators.alice).toMatchObject({ partial: true, lastPage: 2 })

    crawlReturns([userSet('2', 'd2')])
    const { sets } = await CreatorSetsService.catalog('Alice')

    expect(sets.map(s => s.id)).toEqual(['1', '2'])
    expect(vi.mocked(ScraperFactory.browseMediuxUserAll).mock.calls[1][1]?.startPage).toBe(2)
  })

  it('saves a finished crawl as complete', async () =>
  {
    crawlReturns([userSet('1', 'd1')])
    await CreatorSetsService.catalog('Alice')

    CreatorSetsService.flush()

    expect(readCache().creators.alice.partial).toBeUndefined()
  })
})
