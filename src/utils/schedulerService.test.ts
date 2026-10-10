import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import type { AppConfig, AppliedRecord, MediuxUserSet, PosterInfo, ScheduledJob, ScrapeProgress } from '../../electron/ipc/types'

const state = vi.hoisted(() => ({ config: {} as Partial<AppConfig> }))

vi.mock('node-cron', async (importOriginal) =>
{
  const actual = await importOriginal<typeof import('node-cron')>()
  return { default: { ...actual.default, schedule: vi.fn(() => ({ stop: vi.fn() })) } }
})

vi.mock('../../electron/services/config', () => ({
  ConfigService: {
    get: () => structuredClone(state.config),
    set: (patch: Partial<AppConfig>) => { state.config = { ...state.config, ...structuredClone(patch) } },
  },
}))

vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../electron/services/plexService', () => ({
  PlexService: {
    getConnection: vi.fn(),
    tryRestoreFromConfig: vi.fn(),
    findInLibrary: vi.fn(),
    findCollection: vi.fn(),
    uploadPoster: vi.fn(),
  },
}))

vi.mock('../../electron/services/creatorSetsService', () => ({
  CreatorSetsService: { catalog: vi.fn() },
}))

vi.mock('../../electron/scrapers/scraperFactory', () => ({
  ScraperFactory: { scrapeUrl: vi.fn() },
}))

vi.mock('../../electron/runtime/paths', () => ({
  getUserDataPath: () => path.join(os.tmpdir(), 'pps-scheduler-test-no-engine'),
}))

vi.mock('../../electron/runtime/runtime', () => ({ isWebMode: () => true }))

vi.mock('../../electron/runtime/events', () => ({ appEvents: { emitEvent: vi.fn(), onEvent: vi.fn(() => () => {}) } }))

const { SchedulerService } = await import('../../electron/services/schedulerService')
const { ScheduleValidationError, INTERRUPTED_MESSAGE, creatorSyncUrl } = await import('../../electron/services/scheduleUtils')
const { PlexService } = await import('../../electron/services/plexService')
const { CreatorSetsService } = await import('../../electron/services/creatorSetsService')
const { ScraperFactory } = await import('../../electron/scrapers/scraperFactory')
const { appEvents } = await import('../../electron/runtime/events')

const SET_URL = 'https://mediux.pro/sets/100'
const SHOW = { key: '10', title: 'Show', year: 2020, type: 'show', libraryTitle: 'TV Shows' }

function poster(url: string, extra: Partial<PosterInfo> = {}): PosterInfo
{
  return { title: 'Show', year: 2020, url, source: 'mediux', ...extra }
}

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob
{
  return { id: 'job-1', name: 'Show sync', urls: [SET_URL], cronExpr: '0 3 * * 0', enabled: true, ...overrides }
}

function applied(itemKey: string, posterUrls: string[], extra: Partial<AppliedRecord> = {}): AppliedRecord
{
  return { itemKey, title: 'Show', type: 'show', source: 'mediux', posterUrls, appliedAt: '2026-10-01T00:00:00.000Z', ...extra }
}

function userSet(id: string, title: string, posters: PosterInfo[], extra: Partial<MediuxUserSet> = {}): MediuxUserSet
{
  return {
    id, setName: `${title} (2020) Set`, uploader: 'willtong93', posterCount: 0, backdropCount: 0, titleCardCount: 0,
    posters, title, year: 2020, mediaType: 'show', ...extra,
  }
}

function storedJob(id = 'job-1'): ScheduledJob
{
  return state.config.scheduledJobs!.find(j => j.id === id)!
}

function scrapeReturns(byUrl: Record<string, PosterInfo[] | string>)
{
  vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(async (url: string, onProgress: (p: ScrapeProgress) => void) =>
  {
    const result = byUrl[url]
    if (typeof result === 'string')
    {
      onProgress({ url, status: 'error', error: result })
      return []
    }
    return result ?? []
  })
}

beforeEach(() =>
{
  vi.clearAllMocks()
  state.config = { scheduledJobs: [], appliedPosters: [], mediuxFilters: ['poster', 'backdrop', 'title_card'] }
  vi.mocked(PlexService.getConnection).mockReturnValue({ baseUrl: 'http://plex', token: 't', serverName: 'Plex', libraries: [] })
  vi.mocked(PlexService.findInLibrary).mockImplementation(async (req) => (req.title === 'Show' ? SHOW : null) as never)
  vi.mocked(PlexService.uploadPoster).mockResolvedValue({ success: true })
  vi.mocked(ScraperFactory.scrapeUrl).mockResolvedValue([])
})

describe('SchedulerService.save', () =>
{
  it('assigns an id on the server when the client sends none', () =>
  {
    const saved = SchedulerService.save({ name: 'Weekly', urls: [SET_URL], cronExpr: '0 3 * * 0', enabled: true } as ScheduledJob)
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.nextRun).toBeDefined()
    expect(state.config.scheduledJobs).toEqual([
      { id: saved.id, name: 'Weekly', urls: [SET_URL], cronExpr: '0 3 * * 0', enabled: true, skipApplied: true },
    ])
    expect(appEvents.emitEvent).toHaveBeenCalledWith('scheduler:onChange', [expect.objectContaining({ id: saved.id, nextRun: saved.nextRun })])
  })

  it('updates an existing job in place', () =>
  {
    state.config.scheduledJobs = [job(), job({ id: 'job-2' })]
    SchedulerService.save(job({ name: 'Renamed', enabled: false }))
    expect(state.config.scheduledJobs.map(j => [j.id, j.name, j.enabled])).toEqual([['job-1', 'Renamed', false], ['job-2', 'Show sync', true]])
  })

  it('rejects an invalid job and stores nothing', () =>
  {
    expect(() => SchedulerService.save(job({ urls: ['https://example.com/set/1'] }))).toThrow(ScheduleValidationError)
    expect(() => SchedulerService.save(job({ cronExpr: '0 3 * *' }))).toThrow('Expected 5 fields')
    expect(state.config.scheduledJobs).toEqual([])
  })

  it('never stores live queue or progress fields', () =>
  {
    SchedulerService.save(job({ queued: true, progress: { phase: 'applying', done: 1, total: 2 } }))
    expect(storedJob().queued).toBeUndefined()
    expect(storedJob().progress).toBeUndefined()
  })
})

describe('SchedulerService.reorder', () =>
{
  it('stores the jobs in the order given', () =>
  {
    state.config.scheduledJobs = [job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' })]
    const result = SchedulerService.reorder(['c', 'a'])
    expect(result.map(j => j.id)).toEqual(['c', 'a', 'b'])
    expect(state.config.scheduledJobs.map(j => j.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('SchedulerService.preview', () =>
{
  it('describes the schedule and lists upcoming runs', () =>
  {
    const preview = SchedulerService.preview('0 9 * * 1')
    expect(preview).toMatchObject({ valid: true, description: 'Every Monday at 09:00' })
    expect(preview.nextRuns).toHaveLength(3)
    expect(preview.timeZone).toBeTruthy()
  })

  it('reports invalid expressions', () =>
  {
    expect(SchedulerService.preview('0 99 * * *')).toMatchObject({ valid: false, error: '"99" is not a valid hour', nextRuns: [] })
  })
})

describe('SchedulerService._execute', () =>
{
  it('uploads only new artwork, counts titles not in the library, and records the run', async () =>
  {
    state.config.scheduledJobs = [job()]
    state.config.appliedPosters = [applied('10', ['s1'])]
    scrapeReturns({
      [SET_URL]: [
        poster('main'),
        poster('s1', { season: 1 }),
        poster('e1', { season: 1, episode: 1 }),
        poster('missing', { title: 'Missing' }),
      ],
    })

    await SchedulerService._execute(job(), 'manual')

    expect(vi.mocked(PlexService.uploadPoster).mock.calls.map(c => c[0].imageUrl)).toEqual(['main', 'e1'])
    expect(PlexService.findInLibrary).toHaveBeenCalledTimes(2)
    const stored = storedJob()
    expect(stored.lastStatus).toBe('success')
    expect(stored.history).toHaveLength(1)
    expect(stored.history![0]).toMatchObject({ trigger: 'manual', status: 'success', uploaded: 2, skipped: 1, unmatched: 1, failed: 0, urlErrors: 0 })
    expect(stored.history![0].details).toEqual({ applied: ['Show (2020) · 2 posters'], unmatched: ['Missing (2020)'], failed: [] })
    expect(state.config.appliedPosters![0]).toMatchObject({ itemKey: '10', setId: '100', posterUrls: ['main', 'e1'], slots: ['poster', 's1e1'], thumb: 'main' })
  })

  it('re-applies everything when skipping applied artwork is turned off', async () =>
  {
    const noSkip = job({ skipApplied: false })
    state.config.scheduledJobs = [noSkip]
    state.config.appliedPosters = [applied('10', ['main', 's1'])]
    scrapeReturns({ [SET_URL]: [poster('main'), poster('s1', { season: 1 })] })

    await SchedulerService._execute(noSkip, 'schedule')

    expect(PlexService.uploadPoster).toHaveBeenCalledTimes(2)
    expect(storedJob().history![0]).toMatchObject({ uploaded: 2, skipped: 0 })
  })

  it('leaves slots other art already fills when the job only fills gaps', async () =>
  {
    const backup = job({ fillGaps: true })
    state.config.scheduledJobs = [backup]
    state.config.appliedPosters = [applied('10', ['other-e1'], { setId: '7', slots: ['s1e1'] })]
    scrapeReturns({ [SET_URL]: [poster('main'), poster('e1', { season: 1, episode: 1 }), poster('e2', { season: 1, episode: 2 })] })

    await SchedulerService._execute(backup, 'schedule')

    expect(vi.mocked(PlexService.uploadPoster).mock.calls.map(c => c[0].imageUrl)).toEqual(['main', 'e2'])
    expect(storedJob().history![0]).toMatchObject({ uploaded: 2, covered: 1, status: 'success' })
    expect(storedJob().history![0].details!.covered).toEqual(['Show (2020) · 1 poster'])
  })

  it('treats art applied before slot tracking as covering the whole show', async () =>
  {
    const backup = job({ fillGaps: true })
    state.config.scheduledJobs = [backup]
    state.config.appliedPosters = [applied('10', ['old'], { setId: '7' })]
    scrapeReturns({ [SET_URL]: [poster('main'), poster('e1', { season: 1, episode: 1 })] })

    await SchedulerService._execute(backup, 'schedule')

    expect(PlexService.uploadPoster).not.toHaveBeenCalled()
    expect(storedJob().history![0]).toMatchObject({ uploaded: 0, covered: 2 })
  })

  it('is partial when an upload fails, without counting seasons Plex does not have', async () =>
  {
    state.config.scheduledJobs = [job()]
    scrapeReturns({ [SET_URL]: [poster('main'), poster('s9', { season: 9 }), poster('e1', { season: 1, episode: 1 })] })
    vi.mocked(PlexService.uploadPoster).mockImplementation(async (req) =>
    {
      if (req.imageUrl === 's9') return { success: false, error: 'Season 9 not found', skipped: true }
      if (req.imageUrl === 'e1') return { success: false, error: 'Image download failed: 404' }
      return { success: true }
    })

    await SchedulerService._execute(job(), 'schedule')

    expect(storedJob()).toMatchObject({ lastStatus: 'partial', lastError: 'Image download failed: 404' })
    expect(storedJob().history![0]).toMatchObject({ uploaded: 1, failed: 1, noTarget: 1 })
    expect(storedJob().history![0].details!.failed).toEqual(['Show (2020) · Image download failed: 404'])
    expect(storedJob().history![0].details!.noTarget).toEqual(['Show (2020) · 1 poster'])
  })

  it('fails when no URL can be read', async () =>
  {
    state.config.scheduledJobs = [job()]
    scrapeReturns({ [SET_URL]: 'Timed out loading page' })

    await SchedulerService._execute(job(), 'schedule')

    expect(storedJob()).toMatchObject({ lastStatus: 'error', lastError: `${SET_URL}: Timed out loading page` })
    expect(storedJob().history![0]).toMatchObject({ status: 'error', urlErrors: 1 })
  })

  it('reconnects to Plex before running when the connection was lost', async () =>
  {
    state.config.scheduledJobs = [job()]
    vi.mocked(PlexService.getConnection).mockReturnValue(null)
    vi.mocked(PlexService.tryRestoreFromConfig).mockResolvedValue({ success: true, serverName: 'Plex' })
    scrapeReturns({ [SET_URL]: [poster('main')] })

    await SchedulerService._execute(job(), 'schedule')

    expect(PlexService.tryRestoreFromConfig).toHaveBeenCalledOnce()
    expect(storedJob().lastStatus).toBe('success')
  })

  it('fails with a clear message when Plex cannot be reached', async () =>
  {
    state.config.scheduledJobs = [job()]
    vi.mocked(PlexService.getConnection).mockReturnValue(null)
    vi.mocked(PlexService.tryRestoreFromConfig).mockResolvedValue({ success: false })

    await SchedulerService._execute(job(), 'schedule')

    expect(ScraperFactory.scrapeUrl).not.toHaveBeenCalled()
    expect(storedJob()).toMatchObject({ lastStatus: 'error', lastError: 'Not connected to Plex - check that the server is reachable and you are signed in' })

    vi.mocked(PlexService.tryRestoreFromConfig).mockResolvedValue({ success: false, tokenInvalid: true })
    await SchedulerService._execute(job(), 'schedule')
    expect(storedJob().lastError).toBe('Plex sign-in expired - sign in again from Settings')
  })

  it('does not bring back a job deleted while it ran', async () =>
  {
    state.config.scheduledJobs = [job()]
    vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(async () =>
    {
      SchedulerService.delete('job-1')
      return [poster('main')]
    })

    await SchedulerService._execute(job(), 'schedule')

    expect(state.config.scheduledJobs).toEqual([])
  })
})

describe('creator sync', () =>
{
  const CREATOR_URL = creatorSyncUrl('willtong93')

  it('reads the whole catalog through the creator cache and applies every matching set', async () =>
  {
    const creatorJob = job({ urls: [CREATOR_URL], creator: 'willtong93' })
    state.config.scheduledJobs = [creatorJob]
    state.config.mediuxFilters = ['poster', 'title_card']
    vi.mocked(CreatorSetsService.catalog).mockResolvedValue({
      capped: false,
      sets: [
        userSet('20066', 'Show', [poster('main'), poster('bg', { season: 'Backdrop' }), poster('e1', { season: 1, episode: 1 })]),
        userSet('19633', 'Missing', [poster('m-main', { title: 'Missing' })]),
      ],
    })

    await SchedulerService._execute(creatorJob, 'schedule')

    expect(CreatorSetsService.catalog).toHaveBeenCalledWith('willtong93', 60_000)
    expect(ScraperFactory.scrapeUrl).not.toHaveBeenCalled()
    expect(vi.mocked(PlexService.uploadPoster).mock.calls.map(c => c[0].imageUrl)).toEqual(['main', 'e1'])
    expect(vi.mocked(PlexService.findInLibrary).mock.calls.map(c => [c[0].title, c[0].type])).toEqual([['Show', 'show'], ['Missing', 'show']])
    expect(state.config.appliedPosters![0]).toMatchObject({ itemKey: '10', setId: '20066', uploader: 'willtong93', slots: ['poster', 's1e1'] })
    const run = storedJob().history![0]
    expect(run).toMatchObject({ status: 'success', uploaded: 2, unmatched: 1 })
    expect(run.details).toEqual({ applied: ['Show (2020) · 2 posters'], unmatched: ['Missing (2020)'], failed: [] })
  })

  it('reports the position within a set while it applies', async () =>
  {
    const creatorJob = job({ urls: [CREATOR_URL] })
    state.config.scheduledJobs = [creatorJob]
    vi.mocked(CreatorSetsService.catalog).mockResolvedValue({
      capped: false,
      sets: [userSet('1', 'Show', [poster('e1', { season: 1, episode: 1 }), poster('e2', { season: 1, episode: 2 }), poster('e3', { season: 1, episode: 3 })])],
    })
    let release: () => void = () => {}
    vi.mocked(PlexService.uploadPoster).mockImplementation(async (req) =>
    {
      if (req.imageUrl === 'e2') await new Promise<void>(resolve => { release = resolve })
      return { success: true }
    })

    const running = SchedulerService._execute(creatorJob, 'manual')
    await vi.waitFor(() => expect(SchedulerService.list()[0].progress).toMatchObject({
      phase: 'applying', done: 0, total: 1, current: 'Show (2020)', poster: { done: 1, total: 3 },
    }))
    release()
    await running
    expect(SchedulerService.list()[0].progress).toBeUndefined()
  })

  it('reports a creator whose catalog cannot be read as a failed URL', async () =>
  {
    const creatorJob = job({ urls: [CREATOR_URL] })
    state.config.scheduledJobs = [creatorJob]
    vi.mocked(CreatorSetsService.catalog).mockRejectedValue(new Error("Could not load page 3 of @willtong93's sets: fetch failed"))

    await SchedulerService._execute(creatorJob, 'schedule')

    expect(storedJob()).toMatchObject({ lastStatus: 'error', lastError: `${CREATOR_URL}: Could not load page 3 of @willtong93's sets: fetch failed` })
    expect(storedJob().history![0]).toMatchObject({ status: 'error', urlErrors: 1 })
  })
})

describe('run queue', () =>
{
  const urlOf = (id: string) => `https://mediux.pro/sets/${id}`

  it('runs jobs one at a time, with manual runs ahead of waiting scheduled runs', async () =>
  {
    state.config.scheduledJobs = ['1', '2', '3'].map(id => job({ id, name: `Job ${id}`, urls: [urlOf(id)] }))
    const order: string[] = []
    vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(async (url: string) =>
    {
      order.push(url)
      await new Promise(r => setTimeout(r, 5))
      return []
    })

    SchedulerService._enqueue('1', 'schedule')
    SchedulerService._enqueue('2', 'schedule')
    SchedulerService.runNow('3')

    expect(storedJob('1').lastStatus).toBe('running')
    const live = SchedulerService.list()
    expect(live.map(j => [j.id, !!j.queued])).toEqual([['1', false], ['2', true], ['3', true]])
    expect(() => SchedulerService.runNow('1')).toThrow('"Job 1" is already running')
    expect(() => SchedulerService.runNow('2')).toThrow('"Job 2" is already queued')

    await vi.waitFor(() => expect(storedJob('2').lastStatus).toBe('success'))
    expect(order).toEqual([urlOf('1'), urlOf('3'), urlOf('2')])
    expect(SchedulerService.list().some(j => j.queued)).toBe(false)
  })

  it('drops a job deleted while it waited in the queue', async () =>
  {
    state.config.scheduledJobs = [job({ id: '1', urls: [urlOf('1')] }), job({ id: '2', urls: [urlOf('2')] })]
    vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(async () =>
    {
      await new Promise(r => setTimeout(r, 5))
      return []
    })

    SchedulerService._enqueue('1', 'schedule')
    SchedulerService._enqueue('2', 'schedule')
    SchedulerService.delete('2')

    await vi.waitFor(() => expect(storedJob('1').lastStatus).toBe('success'))
    expect(vi.mocked(ScraperFactory.scrapeUrl).mock.calls.map(c => c[0])).toEqual([urlOf('1')])
  })
})

describe('SchedulerService.runNow', () =>
{
  it('returns before the run finishes and records the run as manual', async () =>
  {
    state.config.scheduledJobs = [job()]
    let finishScrape: (posters: PosterInfo[]) => void = () => {}
    vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(() => new Promise(resolve => { finishScrape = resolve }))

    SchedulerService.runNow('job-1')
    expect(storedJob().lastStatus).toBe('running')

    await vi.waitFor(() => expect(ScraperFactory.scrapeUrl).toHaveBeenCalled())
    finishScrape([poster('main')])
    await vi.waitFor(() => expect(storedJob().lastStatus).toBe('success'))
    expect(storedJob().history![0].trigger).toBe('manual')
  })

  it('rejects an unknown job', () =>
  {
    expect(() => SchedulerService.runNow('nope')).toThrow('This job no longer exists')
  })
})

describe('SchedulerService.init', () =>
{
  it('marks jobs interrupted by the last shutdown', () =>
  {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try
    {
      state.config.scheduledJobs = [job({ lastStatus: 'running' }), job({ id: 'job-2', lastStatus: 'success' })]
      SchedulerService.init(null)
      expect(state.config.scheduledJobs.map(j => [j.lastStatus, j.lastError])).toEqual([
        ['error', INTERRUPTED_MESSAGE],
        ['success', undefined],
      ])
    }
    finally
    {
      vi.useRealTimers()
    }
  })
})
