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

const { CreatorSetsService } = await import('../../electron/services/creatorSetsService')
const { ScraperFactory } = await import('../../electron/scrapers/scraperFactory')

function userSet(id: string, dateUpdated: string): MediuxUserSet
{
  return {
    id, setName: `Set ${id}`, uploader: 'alice', posterCount: 1, backdropCount: 0, titleCardCount: 0,
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
  CreatorSetsService.clear()
  fs.rmSync(path.join(dir, 'creator-sets.json'), { force: true })
})

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

  it('rejects when the crawl fails', async () =>
  {
    vi.mocked(ScraperFactory.browseMediuxUserAll).mockRejectedValue(new Error("Could not load page 2 of @bob's sets: fetch failed"))

    await expect(CreatorSetsService.catalog('Bob')).rejects.toThrow("Could not load page 2 of @bob's sets: fetch failed")
  })
})
