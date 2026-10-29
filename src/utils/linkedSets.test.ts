import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LinkedItemRef, PosterSetSummary } from '../../electron/ipc/types'

const mocks = vi.hoisted(() => ({
  linkPosterdb: vi.fn(),
  linkMediux: vi.fn(),
  store: {} as { linkedSets?: Record<string, string[]> },
}))

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => ({ ...mocks.store }),
    set: (partial: Record<string, unknown>) => { Object.assign(mocks.store, partial) },
  },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../electron/scrapers/scraperFactory', () => ({
  ScraperFactory: {
    linkPosterdb: (...args: unknown[]) => mocks.linkPosterdb(...args),
    linkMediux: (...args: unknown[]) => mocks.linkMediux(...args),
  },
}))

const { LinkedSetsService, normalizeLink } = await import('../../electron/services/linkedSets')

const item: LinkedItemRef = { key: '42', type: 'collection', title: 'Marvel Cinematic Universe' }
const SET = 'https://theposterdb.com/set/4475'
const MEDIUX = 'https://mediux.pro/sets/9'

function summary(id: string, source: PosterSetSummary['source'] = 'posterdb'): PosterSetSummary
{
  return { id, source, setName: `Set ${id}`, uploader: 'red', posterCount: 1, backdropCount: 0, titleCardCount: 0, posters: [] }
}

beforeEach(() =>
{
  mocks.linkPosterdb.mockReset()
  mocks.linkMediux.mockReset()
  delete mocks.store.linkedSets
  LinkedSetsService.clearCache()
})

describe('normalizeLink', () =>
{
  it('adds the scheme and drops the query, fragment, and trailing slash', () =>
  {
    expect(normalizeLink('  theposterdb.com/set/4475/?ref=x#top ')).toBe(SET)
    expect(normalizeLink('http://mediux.pro/sets/9')).toBe(MEDIUX)
  })

  it('rejects text that is not a link', () =>
  {
    expect(normalizeLink('')).toBeNull()
    expect(normalizeLink('not a link')).toBeNull()
  })
})

describe('LinkedSetsService.link', () =>
{
  it('reads the page, tags the sets with the link, and remembers it once', async () =>
  {
    mocks.linkPosterdb.mockResolvedValue([summary('4475')])

    const first = await LinkedSetsService.link(item, 'theposterdb.com/set/4475')
    expect(first.errors).toBeUndefined()
    expect(first.sets.map(s => [s.id, s.linkedFrom])).toEqual([['4475', SET]])
    expect(mocks.linkPosterdb).toHaveBeenCalledWith(SET, 'Marvel Cinematic Universe', undefined, 'collection')

    await LinkedSetsService.link(item, SET)
    expect(LinkedSetsService.links('42')).toEqual([SET])
  })

  it('routes MediUX links to the MediUX reader', async () =>
  {
    mocks.linkMediux.mockResolvedValue([summary('9', 'mediux')])
    const res = await LinkedSetsService.link(item, MEDIUX)
    expect(res.sets[0].linkedFrom).toBe(MEDIUX)
    expect(mocks.linkMediux).toHaveBeenCalledWith(MEDIUX)
    expect(mocks.linkPosterdb).not.toHaveBeenCalled()
  })

  it('refuses other sites, empty pages, and failures without remembering them', async () =>
  {
    expect((await LinkedSetsService.link(item, 'https://example.com/set/1')).errors?.[0].error).toMatch(/Only MediUX and ThePosterDB/)
    expect((await LinkedSetsService.link(item, 'not a link')).errors?.[0].error).toBe('That is not a link')
    expect((await LinkedSetsService.link(item, 'nope')).errors?.[0].error).toMatch(/Only MediUX and ThePosterDB/)

    mocks.linkPosterdb.mockResolvedValue([])
    expect((await LinkedSetsService.link(item, SET)).errors?.[0].error).toMatch(/No sets were found/)

    mocks.linkPosterdb.mockRejectedValue(new Error('The set page could not be read'))
    expect((await LinkedSetsService.link(item, SET)).errors?.[0]).toEqual({ url: SET, error: 'The set page could not be read' })

    expect(LinkedSetsService.links('42')).toEqual([])
  })
})

describe('LinkedSetsService.resolve and unlink', () =>
{
  it('reads every link, reuses recent reads, and reports a link that failed', async () =>
  {
    mocks.store.linkedSets = { '42': [SET, MEDIUX] }
    mocks.linkPosterdb.mockResolvedValue([summary('4475')])
    mocks.linkMediux.mockRejectedValue(new Error('No set data found at that link'))

    const res = await LinkedSetsService.resolve(item)
    expect(res.sets.map(s => s.id)).toEqual(['4475'])
    expect(res.errors).toEqual([{ url: MEDIUX, error: 'No set data found at that link' }])

    await LinkedSetsService.resolve(item)
    expect(mocks.linkPosterdb).toHaveBeenCalledTimes(1)
    // A failed read is not remembered, so it is retried.
    expect(mocks.linkMediux).toHaveBeenCalledTimes(2)

    await LinkedSetsService.resolve(item, true)
    expect(mocks.linkPosterdb).toHaveBeenCalledTimes(2)
  })

  it('forgets a link and drops the item once none are left', async () =>
  {
    mocks.store.linkedSets = { '42': [SET, MEDIUX], '7': [SET] }
    LinkedSetsService.unlink('42', SET)
    expect(mocks.store.linkedSets).toEqual({ '42': [MEDIUX], '7': [SET] })
    LinkedSetsService.unlink('42', MEDIUX)
    expect(mocks.store.linkedSets).toEqual({ '7': [SET] })
  })
})
