import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PosterSetSummary } from '../../electron/ipc/types'

const mocks = vi.hoisted(() => ({ mediuxBrowse: vi.fn(), posterdbBrowse: vi.fn(), posterdbClose: vi.fn() }))

vi.mock('../../electron/scrapers/posterdbScraper', () => ({
  PosterdbScraper: class
  {
    browseSets = mocks.posterdbBrowse
    close = mocks.posterdbClose
    abort() {}
  },
  posterdbUrlType: () => 'set',
}))

vi.mock('../../electron/scrapers/mediuxScraper', () => ({
  MediuxScraper: class
  {
    browseSets = mocks.mediuxBrowse
    abort() {}
    async close() {}
  },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: { get: () => ({ maxWorkers: 1, mediuxFilters: ['poster'] }) },
}))

const { ScraperFactory } = await import('../../electron/scrapers/scraperFactory')

const DEADLINE_MS = 3 * 60_000
const SET: PosterSetSummary = { id: '1', source: 'mediux', setName: 'Dune', uploader: 'alice', posterCount: 1, backdropCount: 0, titleCardCount: 0, posters: [] }

interface PosterdbResult
{
  sets: PosterSetSummary[]
  capped: boolean
}

/** A promise the test settles by hand. */
function deferred<T>()
{
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res =>
  {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() =>
{
  mocks.mediuxBrowse.mockReset()
  mocks.posterdbBrowse.mockReset()
  mocks.posterdbClose.mockReset()
  mocks.posterdbClose.mockResolvedValue(undefined)
})

afterEach(() =>
{
  vi.useRealTimers()
})

describe('ScraperFactory MediUX browses', () =>
{
  it('reads a title once for callers asking at the same time', async () =>
  {
    const page = deferred<PosterSetSummary[]>()
    mocks.mediuxBrowse.mockReturnValue(page.promise)

    const first = ScraperFactory.browseMediux('438631', 'movie')
    const second = ScraperFactory.browseMediux('438631', 'movie')
    const show = ScraperFactory.browseMediux('438631', 'show')
    page.resolve([SET])

    expect(await Promise.all([first, second, show])).toEqual([[SET], [SET], [SET]])
    expect(mocks.mediuxBrowse).toHaveBeenCalledTimes(2)
  })

  it('stops waiting at the deadline and starts afresh on the next ask', async () =>
  {
    vi.useFakeTimers()
    mocks.mediuxBrowse
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce([SET])

    const stuck = expect(ScraperFactory.browseMediux('1', 'movie')).rejects.toThrow('did not finish within 3 minutes')
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)
    await stuck

    await expect(ScraperFactory.browseMediux('1', 'movie')).resolves.toEqual([SET])
    expect(mocks.mediuxBrowse).toHaveBeenCalledTimes(2)
  })
})

describe('ScraperFactory ThePosterDB browses', () =>
{
  it('reads a title once for callers asking at the same time, keeping a fresh ask apart', async () =>
  {
    const page = deferred<PosterdbResult>()
    mocks.posterdbBrowse.mockReturnValue(page.promise)

    const first = ScraperFactory.browsePosterdb('Dune', 2021, 'movie')
    const second = ScraperFactory.browsePosterdb('Dune', 2021, 'movie')
    const fresh = ScraperFactory.browsePosterdb('Dune', 2021, 'movie', true)
    page.resolve({ sets: [SET], capped: false })

    const results = await Promise.all([first, second, fresh])
    expect(results.map(r => r.sets)).toEqual([[SET], [SET], [SET]])
    expect(mocks.posterdbBrowse).toHaveBeenCalledTimes(2)
    expect(mocks.posterdbClose).toHaveBeenCalledTimes(1)
  })

  it('reports a browse past the deadline and closes the browser once the browse ends', async () =>
  {
    vi.useFakeTimers()
    const page = deferred<PosterdbResult>()
    mocks.posterdbBrowse.mockReturnValue(page.promise)

    const waiting = ScraperFactory.browsePosterdb('Dune', 2021, 'movie')
    await vi.advanceTimersByTimeAsync(DEADLINE_MS)

    await expect(waiting).resolves.toMatchObject({ sets: [], capped: false, error: expect.stringContaining('did not finish within 3 minutes') })
    expect(mocks.posterdbClose).not.toHaveBeenCalled()

    page.resolve({ sets: [], capped: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.posterdbClose).toHaveBeenCalledTimes(1)
  })
})
