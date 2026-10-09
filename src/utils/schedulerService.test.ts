import { describe, it, expect, beforeEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import type { AppConfig, AppliedRecord, PosterInfo, ScheduledJob, ScrapeProgress } from '../../electron/ipc/types'

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

vi.mock('../../electron/scrapers/scraperFactory', () => ({
  ScraperFactory: { scrapeUrl: vi.fn() },
}))

vi.mock('../../electron/runtime/paths', () => ({
  getUserDataPath: () => path.join(os.tmpdir(), 'pps-scheduler-test-no-engine'),
}))

vi.mock('../../electron/runtime/runtime', () => ({ isWebMode: () => true }))

vi.mock('../../electron/runtime/events', () => ({ appEvents: { emitEvent: vi.fn() } }))

const { SchedulerService } = await import('../../electron/services/schedulerService')
const { ScheduleValidationError, INTERRUPTED_MESSAGE } = await import('../../electron/services/scheduleUtils')
const { PlexService } = await import('../../electron/services/plexService')
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

function applied(itemKey: string, posterUrls: string[]): AppliedRecord
{
  return { itemKey, title: 'Show', type: 'show', source: 'mediux', posterUrls, appliedAt: '2026-10-01T00:00:00.000Z' }
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
  state.config = { scheduledJobs: [], appliedPosters: [] }
  vi.mocked(PlexService.getConnection).mockReturnValue({ baseUrl: 'http://plex', token: 't', serverName: 'Plex', libraries: [] })
  vi.mocked(PlexService.findInLibrary).mockImplementation(async (req) => (req.title === 'Show' ? SHOW : null) as never)
  vi.mocked(PlexService.uploadPoster).mockResolvedValue({ success: true })
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
    expect(state.config.appliedPosters![0]).toMatchObject({ itemKey: '10', setId: '100', posterUrls: ['main', 'e1'], thumb: 'main' })
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
    expect(storedJob().history![0]).toMatchObject({ uploaded: 1, failed: 1 })
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

describe('SchedulerService.runNow', () =>
{
  it('returns before the run finishes and refuses to start it twice', async () =>
  {
    state.config.scheduledJobs = [job()]
    let finishScrape: (posters: PosterInfo[]) => void = () => {}
    vi.mocked(ScraperFactory.scrapeUrl).mockImplementation(() => new Promise(resolve => { finishScrape = resolve }))

    SchedulerService.runNow('job-1')
    expect(storedJob().lastStatus).toBe('running')
    expect(() => SchedulerService.runNow('job-1')).toThrow('"Show sync" is already running')

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
