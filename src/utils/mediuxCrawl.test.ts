import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MediuxUserSet } from '../../electron/ipc/types'

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

const { MediuxScraper } = await import('../../electron/scrapers/mediuxScraper')

/** A creator page as MediUX serves it: the sets live in an RSC flight payload script. */
function pageHtml(sets: Array<{ id: number; name: string }>): string
{
  const payload = JSON.stringify({
    sets: sets.map(s => ({
      id: s.id, set_name: s.name, user_created: { username: 'alice' },
      files: [{ id: `f${s.id}`, fileType: 'poster', title: s.name.replace(/ Set$/, '') }],
    })),
  })
  const script = sets.length ? `<script>self.__next_f.push([1,"${payload.replace(/"/g, '\\"')}"])</script>` : ''
  return `<html><head></head><body>${script}${'<!-- padding -->'.repeat(60)}</body></html>`
}

function response(html: string)
{
  return { ok: true, status: 200, text: async () => html }
}

/** A scraper whose browser fallback finds nothing, so only the HTTP path matters. */
function scraperWithoutBrowser()
{
  const scraper = new MediuxScraper()
  const fakePage = { goto: async () => {}, waitForSelector: async () => {}, waitForTimeout: async () => {}, $$eval: async () => [] }
  ;(scraper as unknown as { newContext: () => Promise<unknown> }).newContext = async () => ({ context: { close: async () => {} }, page: fakePage })
  return scraper
}

describe('MediuxScraper.browseUserSets', () =>
{
  const fetchMock = vi.fn()

  beforeEach(() =>
  {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() =>
  {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a creator page that failed to load', async () =>
  {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(response(pageHtml([{ id: 5, name: 'Alpha (2020) Set' }])))

    const pending = scraperWithoutBrowser().browseUserSets('alice', 2)
    await vi.advanceTimersByTimeAsync(2_500)
    const sets = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sets.map(s => [s.id, s.title, s.year])).toEqual([['5', 'Alpha', 2020]])
  })

  it('throws when a page cannot be loaded instead of ending the catalog', async () =>
  {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const pending = scraperWithoutBrowser().browseUserSets('alice', 3)
    const outcome = expect(pending).rejects.toThrow("Could not load page 3 of @alice's sets: fetch failed")
    await vi.advanceTimersByTimeAsync(2_500)
    await outcome
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a page that loaded with no sets as the end of the catalog', async () =>
  {
    fetchMock.mockResolvedValue(response(pageHtml([])))

    const pending = scraperWithoutBrowser().browseUserSets('alice', 9)
    await vi.advanceTimersByTimeAsync(2_500)
    await expect(pending).resolves.toEqual([])
  })
})

describe('MediuxScraper.browseAllUserSets', () =>
{
  const set = (page: number) => ({ id: `s${page}`, title: `Set ${page}` } as MediuxUserSet)

  it('rejects when a page fails rather than reporting a short catalog', async () =>
  {
    const scraper = new MediuxScraper()
    scraper.browseUserSets = vi.fn(async (_u: string, page = 1) =>
    {
      if (page === 3) throw new Error('boom')
      return page <= 6 ? [set(page)] : []
    })
    const onBatch = vi.fn()

    await expect(scraper.browseAllUserSets('alice', { batchSize: 2, onBatch })).rejects.toThrow('boom')
    expect(onBatch).not.toHaveBeenCalledWith([], expect.objectContaining({ done: true }))
  })

  it('stops after a batch with nothing new and reports the full catalog', async () =>
  {
    const scraper = new MediuxScraper()
    scraper.browseUserSets = vi.fn(async (_u: string, page = 1) => (page <= 3 ? [set(page)] : []))
    const onBatch = vi.fn()

    const result = await scraper.browseAllUserSets('alice', { batchSize: 2, onBatch })

    expect(result.sets.map(s => s.id)).toEqual(['s1', 's2', 's3'])
    expect(result.capped).toBe(false)
    expect(onBatch).toHaveBeenLastCalledWith([], expect.objectContaining({ done: true, capped: false }))
  })
})
