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

const { MediuxScraper, hasFlightData } = await import('../../electron/scrapers/mediuxScraper')

const PADDING = '<!-- padding -->'.repeat(60)
/** A page Cloudflare serves instead of MediUX's own: long enough to parse, without the flight payload. */
const CHALLENGE = `<html><head><title>Just a moment...</title></head><body>${PADDING}</body></html>`

/** The flight payload script a MediUX title page carries, with or without sets. */
function flightScript(sets: Array<{ id: number; name: string }>): string
{
  const payload = JSON.stringify({
    sets: sets.map(s => ({
      id: s.id, set_name: s.name, user_created: { username: 'alice' },
      files: [{ id: `f${s.id}`, fileType: 'poster', title: s.name.replace(/ Set$/, '') }],
    })),
  })
  return `self.__next_f.push([1,"${payload.replace(/"/g, '\\"')}"])`
}

function titlePage(sets: Array<{ id: number; name: string }>): string
{
  return `<html><head></head><body><script>${flightScript(sets)}</script>${PADDING}</body></html>`
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
