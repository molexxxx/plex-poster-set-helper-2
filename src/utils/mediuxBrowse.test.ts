import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => ({
      mediuxFilters: ['poster', 'backdrop', 'title_card'],
      scraperMinDelay: 0, scraperMaxDelay: 0, scraperInitialDelay: 0, scraperBatchDelay: 0,
      scraperPageWaitMin: 0, scraperPageWaitMax: 0, maxWorkers: 4,
    }),
  },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

const { MediuxScraper } = await import('../../electron/scrapers/mediux/mediuxScraper')
const { hasFlightData } = await import('../../electron/scrapers/mediux/flightPayload')
const { Logger } = await import('../../electron/services/logger')

const PADDING = '<!-- padding -->'.repeat(60)
/** A page Cloudflare serves instead of MediUX's own: long enough to parse, without the flight payload. */
const CHALLENGE = `<html><head><title>Just a moment...</title></head><body>${PADDING}</body></html>`

/** The flight payload script a MediUX page carries, holding the given raw sets. */
function rawFlightScript(sets: object[]): string
{
  const payload = JSON.stringify({ sets })
  return `self.__next_f.push([1,"${payload.replace(/"/g, '\\"')}"])`
}

/** The flight payload script for one-poster sets, or for none. */
function flightScript(sets: Array<{ id: number; name: string }>): string
{
  return rawFlightScript(sets.map(s => ({
    id: s.id, set_name: s.name, user_created: { username: 'alice' },
    files: [{ id: `f${s.id}`, fileType: 'poster', title: s.name.replace(/ Set$/, '') }],
  })))
}

function pageWith(script: string): string
{
  return `<html><head></head><body><script>${script}</script>${PADDING}</body></html>`
}

function titlePage(sets: Array<{ id: number; name: string }>): string
{
  return pageWith(flightScript(sets))
}

/** A collection set as a title page lists it, or with the per-movie ids its own page adds. */
function collectionSet(id: number, withMovies = false): object
{
  const poster = (file: string, title: string, movie?: { id: number; title: string; release_date: string }) =>
    ({ id: `${id}${file}`, fileType: 'poster', title, ...(movie ? { movie_id: movie } : {}) })
  return {
    id, set_name: 'Toy Story Collection', user_created: { username: 'alice' },
    ...(withMovies ? { collection: { id: 10194, collection_name: 'Toy Story Collection' } } : {}),
    files: withMovies
      ? [
          poster('a', 'Toy Story (1995)', { id: 862, title: 'Toy Story', release_date: '1995-11-22' }),
          poster('b', 'Toy Story 2 (1999)', { id: 863, title: 'Toy Story 2', release_date: '1999-11-24' }),
        ]
      : [poster('a', 'Toy Story (1995)'), poster('b', 'Toy Story 2 (1999)')],
  }
}

/** A promise the test settles by hand. */
function deferred()
{
  let resolve!: () => void
  const promise = new Promise<void>(res =>
  {
    resolve = res
  })
  return { promise, resolve }
}

function response(html: string)
{
  return { ok: true, status: 200, text: async () => html }
}

function timedOut()
{
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}

/** A scraper whose headless browser finds the given scripts on any page. */
function scraperWithBrowser(scripts: string[] = [])
{
  const scraper = new MediuxScraper()
  const page = { goto: async () => {}, waitForSelector: async () => {}, waitForTimeout: async () => {}, $$eval: async () => scripts }
  const newContext = vi.fn(async () => ({ context: { close: async () => {} }, page }))
  ;(scraper as unknown as { newContext: typeof newContext }).newContext = newContext
  return { scraper, newContext }
}

describe('MediuxScraper.browseSets', () =>
{
  const fetchMock = vi.fn()

  beforeEach(() =>
  {
    fetchMock.mockReset()
    vi.mocked(Logger.warn).mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() =>
  {
    vi.unstubAllGlobals()
  })

  it('asks again when the title page runs out of time', async () =>
  {
    fetchMock
      .mockRejectedValueOnce(timedOut())
      .mockResolvedValueOnce(response(titlePage([{ id: 5, name: 'Dune (2021) Set' }])))
    const { scraper, newContext } = scraperWithBrowser()

    const sets = await scraper.browseSets('438631', 'movie')

    expect(sets.map(s => s.id)).toEqual(['5'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(newContext).not.toHaveBeenCalled()
    expect(Logger.warn).not.toHaveBeenCalled()
  })

  it('asks again for a collection set page that runs out of time', async () =>
  {
    fetchMock
      .mockResolvedValueOnce(response(pageWith(rawFlightScript([collectionSet(9)]))))
      .mockRejectedValueOnce(timedOut())
      .mockResolvedValueOnce(response(pageWith(rawFlightScript([collectionSet(9, true)]))))
    const { scraper, newContext } = scraperWithBrowser()

    const sets = await scraper.browseSets('862', 'movie')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://mediux.pro/movies/862', 'https://mediux.pro/sets/9', 'https://mediux.pro/sets/9',
    ])
    expect(sets[0].posters.map(p => p.tmdbId)).toEqual(['862', '863'])
    expect(newContext).not.toHaveBeenCalled()
    expect(Logger.warn).not.toHaveBeenCalled()
  })

  it('shows a collection set as listed when its page has not answered within two minutes', async () =>
  {
    const held = deferred()
    fetchMock.mockImplementation(async (url: string) =>
    {
      if (!url.includes('/sets/')) return response(pageWith(rawFlightScript([collectionSet(9)])))
      await held.promise
      return response(pageWith(rawFlightScript([collectionSet(9, true)])))
    })
    const { scraper } = scraperWithBrowser()

    vi.useFakeTimers()
    try
    {
      const browsing = scraper.browseSets('862', 'movie')
      await vi.advanceTimersByTimeAsync(119_000)
      let answered = false
      void browsing.then(() =>
      {
        answered = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(answered).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
      const sets = await browsing
      expect(sets[0].posters.map(p => p.tmdbId)).toEqual([undefined, undefined])
      held.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    finally
    {
      vi.useRealTimers()
    }
  })

  it('starts no collection set reads once the two minutes have passed', async () =>
  {
    const held = deferred()
    const ids = [1, 2, 3, 4, 5, 6]
    fetchMock.mockImplementation(async (url: string) =>
    {
      if (!url.includes('/sets/')) return response(pageWith(rawFlightScript(ids.map(id => collectionSet(id)))))
      await held.promise
      return response(pageWith(rawFlightScript([collectionSet(Number(url.split('/').pop()), true)])))
    })
    const { scraper } = scraperWithBrowser()

    vi.useFakeTimers()
    try
    {
      const browsing = scraper.browseSets('862', 'movie')
      await vi.advanceTimersByTimeAsync(120_000)
      const sets = await browsing
      expect(sets).toHaveLength(6)
      expect(fetchMock).toHaveBeenCalledTimes(5)

      held.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(5)
    }
    finally
    {
      vi.useRealTimers()
    }
  })

  it('says MediUX was slow when both tries run out of time, without a browser load', async () =>
  {
    fetchMock.mockRejectedValue(timedOut())
    const { scraper, newContext } = scraperWithBrowser()

    await expect(scraper.browseSets('438631', 'movie')).rejects.toThrow('it took more than a minute to answer')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(newContext).not.toHaveBeenCalled()
  })

  it('takes a real title page without sets at its word', async () =>
  {
    fetchMock.mockResolvedValue(response(titlePage([])))
    const { scraper, newContext } = scraperWithBrowser()

    await expect(scraper.browseSets('438631', 'movie')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(newContext).not.toHaveBeenCalled()
  })

  it('loads a challenge page in the browser', async () =>
  {
    fetchMock.mockResolvedValue(response(CHALLENGE))
    const { scraper, newContext } = scraperWithBrowser([flightScript([{ id: 7, name: 'Dune (2021) Set' }])])

    const sets = await scraper.browseSets('438631', 'movie')

    expect(sets.map(s => s.id)).toEqual(['7'])
    expect(newContext).toHaveBeenCalledTimes(1)
  })

  it('falls back to the browser when the title page cannot be read', async () =>
  {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const { scraper, newContext } = scraperWithBrowser([flightScript([{ id: 8, name: 'Dune (2021) Set' }])])

    const sets = await scraper.browseSets('438631', 'movie')

    expect(sets.map(s => s.id)).toEqual(['8'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(newContext).toHaveBeenCalledTimes(1)
  })
})

describe('hasFlightData', () =>
{
  it('tells MediUX pages from block pages', () =>
  {
    expect(hasFlightData([flightScript([])])).toBe(true)
    expect(hasFlightData(['window.dataLayer = []', ''])).toBe(false)
    expect(hasFlightData([])).toBe(false)
  })
})
