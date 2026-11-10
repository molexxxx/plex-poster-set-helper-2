import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PosterInfo, ScheduledJob, ScrapeProgress } from '../../electron/ipc/types'

const mocks = vi.hoisted(() => ({ posterdbScrape: vi.fn(), mediuxScrape: vi.fn() }))

vi.mock('../../electron/scrapers/posterdbScraper', () => ({
  PosterdbScraper: class
  {
    scrape = mocks.posterdbScrape
    abort() {}
    async close() {}
  },
  posterdbUrlType: () => 'set',
}))

vi.mock('../../electron/scrapers/mediuxScraper', () => ({
  MediuxScraper: class
  {
    scrape = mocks.mediuxScrape
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
const {
  artworkOverride, creatorSyncUrl, describeArtworkTypes, jobArtworkTypes, normalizeJob, parseArtworkTypes, planQuickSync, ScheduleValidationError,
} = await import('../../electron/services/scheduleUtils')

const POSTERS: PosterInfo[] = [
  { title: 'Show', url: 'main', source: 'posterdb' },
  { title: 'Show', url: 'bg', source: 'posterdb', season: 'Backdrop' },
  { title: 'Show', url: 'e1', source: 'posterdb', season: 1, episode: 1 },
]

const noProgress = (_: ScrapeProgress) => {}

beforeEach(() =>
{
  vi.clearAllMocks()
})

describe('artwork type helpers', () =>
{
  it('reads only known types, in display order, from untrusted input', () =>
  {
    expect(parseArtworkTypes(['title_card', 'nope', 'poster', 'poster', 3])).toEqual(['poster', 'title_card'])
    expect(parseArtworkTypes([])).toEqual([])
    expect(parseArtworkTypes('poster')).toBeUndefined()
    expect(parseArtworkTypes(undefined)).toBeUndefined()
  })

  it('stores a choice only when it differs from Settings', () =>
  {
    expect(artworkOverride(['backdrop', 'poster'], ['poster', 'backdrop'])).toBeUndefined()
    expect(artworkOverride(new Set(['title_card', 'poster']), ['poster'])).toEqual(['poster', 'title_card'])
    expect(artworkOverride(['poster'], [])).toEqual(['poster'])
  })

  it('names the types for a sentence', () =>
  {
    expect(describeArtworkTypes(['title_card', 'poster', 'backdrop'])).toBe('posters, backdrops, and title cards')
    expect(describeArtworkTypes(['title_card', 'poster'])).toBe('posters and title cards')
    expect(describeArtworkTypes(['backdrop'])).toBe('backdrops')
    expect(describeArtworkTypes([])).toBe('no artwork')
  })

  it('uses a job\'s own types before the Settings ones', () =>
  {
    expect(jobArtworkTypes({ assetTypes: ['poster'] }, ['poster', 'title_card'])).toEqual(['poster'])
    expect(jobArtworkTypes({}, ['poster', 'title_card'])).toEqual(['poster', 'title_card'])
    expect(jobArtworkTypes({}, undefined)).toEqual(['poster', 'backdrop', 'title_card'])
  })
})

describe('normalizeJob artwork types', () =>
{
  const base = { name: 'Friends', urls: ['https://mediux.pro/sets/1'], cronExpr: '0 3 * * *' }
  const makeId = () => 'id'

  it('keeps a job\'s own types and drops unknown ones', () =>
  {
    expect(normalizeJob({ ...base, assetTypes: ['backdrop', 'poster', 'junk'] }, undefined, { makeId }).assetTypes).toEqual(['poster', 'backdrop'])
  })

  it('leaves a job without types following Settings', () =>
  {
    expect(normalizeJob(base, undefined, { makeId }).assetTypes).toBeUndefined()
    expect(normalizeJob({ ...base, assetTypes: 'poster' }, undefined, { makeId }).assetTypes).toBeUndefined()
  })

  it('rejects a job that picks no type at all', () =>
  {
    expect(() => normalizeJob({ ...base, assetTypes: ['junk'] }, undefined, { makeId })).toThrow(ScheduleValidationError)
  })
})

describe('planQuickSync artwork types', () =>
{
  const wide: ScheduledJob = {
    id: 'job-1', name: 'Sync @Alice', urls: [creatorSyncUrl('Alice')], cronExpr: '0 3 * * 0', enabled: true, creator: 'Alice',
    assetTypes: ['poster', 'backdrop'],
  }
  const request = { urls: [creatorSyncUrl('Alice')], name: 'Sync @Alice', cronExpr: '0 3 * * 0', creator: 'Alice', groupByCreator: true }

  it('gives a new job the types picked where it was scheduled', () =>
  {
    const plan = planQuickSync([], { urls: ['https://mediux.pro/sets/9'], name: 'Friends', cronExpr: '0 3 * * 0', assetTypes: ['title_card', 'poster'] }, () => 'new')
    expect(plan.kind).toBe('create')
    expect(plan.job.assetTypes).toEqual(['poster', 'title_card'])
  })

  it('leaves the types of a job that already covers the set alone', () =>
  {
    const plan = planQuickSync([wide], { ...request, urls: ['https://mediux.pro/sets/9'], assetTypes: ['title_card'] }, () => 'new')
    expect(plan.kind).toBe('exists')
    expect(plan.job.assetTypes).toEqual(['poster', 'backdrop'])
  })

  it('updates a sync whose types change in the dialog, and clears them to follow Settings', () =>
  {
    const same = planQuickSync([wide], { ...request, overrides: { cronExpr: '0 3 * * 0', assetTypes: ['backdrop', 'poster'] } }, () => 'new')
    expect(same.kind).toBe('exists')

    const changed = planQuickSync([wide], { ...request, overrides: { cronExpr: '0 3 * * 0', assetTypes: ['poster'] } }, () => 'new')
    expect(changed.kind).toBe('update')
    expect(changed.job.assetTypes).toEqual(['poster'])

    const cleared = planQuickSync([wide], { ...request, overrides: { cronExpr: '0 3 * * 0', assetTypes: undefined } }, () => 'new')
    expect(cleared.kind).toBe('update')
    expect(cleared.job.assetTypes).toBeUndefined()
    expect('assetTypes' in cleared.job).toBe(false)
  })
})

describe('ScraperFactory.scrapeUrl artwork types', () =>
{
  it('passes the types to the site scraper and keeps only those types from either site', async () =>
  {
    mocks.posterdbScrape.mockResolvedValue(POSTERS)
    const posters = await ScraperFactory.scrapeUrl('https://theposterdb.com/set/1', noProgress, 0, ['poster', 'backdrop'])
    expect(mocks.posterdbScrape).toHaveBeenCalledWith('https://theposterdb.com/set/1', ['poster', 'backdrop'])
    expect(posters.map(p => p.url)).toEqual(['main', 'bg'])
  })

  it('leaves the results alone when no types are given', async () =>
  {
    mocks.mediuxScrape.mockResolvedValue(POSTERS)
    const posters = await ScraperFactory.scrapeUrl('https://mediux.pro/sets/1', noProgress)
    expect(mocks.mediuxScrape).toHaveBeenCalledWith('https://mediux.pro/sets/1', undefined)
    expect(posters).toHaveLength(3)
  })
})
