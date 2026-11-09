import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pps-anime-list-')), autoUpdate: true as boolean | undefined }

vi.mock('../../electron/services/config', () => ({ ConfigService: { get: () => ({ animeListAutoUpdate: state.autoUpdate }) } }))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../electron/runtime/paths', () => ({ getUserDataPath: () => state.dir }))

const { AnimeMappingService, animeListUpdateDue, REFRESH_AFTER_MS, RETRY_AFTER_MS } =
  await import('../../electron/services/animeMappingService')

const DAY_MS = 24 * 60 * 60 * 1000
const cacheFile = path.join(state.dir, 'anime-list-full.json')
const fetchMock = vi.fn()

const oldList = [{ anidb_id: 1, themoviedb_id: 100 }, { anidb_id: 2, thetvdb_id: '200', imdb_id: 'tt0000002,tt0000003' }]
const newList = [{ anidb_id: 1, themoviedb_id: 101 }, { anidb_id: 2, themoviedb_id: [202, 203] }, { anidb_id: 3, themoviedb_id: 300 }]

function writeCache(list: unknown[], ageMs: number): void
{
  fs.writeFileSync(cacheFile, JSON.stringify(list))
  const at = new Date(Date.now() - ageMs)
  fs.utimesSync(cacheFile, at, at)
}

function serve(list: unknown[]): void
{
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => list })
}

beforeEach(() =>
{
  vi.clearAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  AnimeMappingService.reset()
  fs.rmSync(cacheFile, { force: true })
  state.autoUpdate = true
})

afterAll(() =>
{
  vi.unstubAllGlobals()
  fs.rmSync(state.dir, { recursive: true, force: true })
})

describe('animeListUpdateDue', () =>
{
  const now = 1_800_000_000_000

  it('updates a list once it is a week old', () =>
  {
    expect(animeListUpdateDue(now - REFRESH_AFTER_MS, now, true, 0)).toBe(true)
    expect(animeListUpdateDue(now - REFRESH_AFTER_MS + 1, now, true, 0)).toBe(false)
  })

  it('never updates when automatic updates are off or nothing was downloaded', () =>
  {
    expect(animeListUpdateDue(now - 30 * DAY_MS, now, false, 0)).toBe(false)
    expect(animeListUpdateDue(0, now, true, 0)).toBe(false)
  })

  it('waits after a failed download before trying again', () =>
  {
    const old = now - 30 * DAY_MS
    expect(animeListUpdateDue(old, now, true, now - RETRY_AFTER_MS + 1)).toBe(false)
    expect(animeListUpdateDue(old, now, true, now - RETRY_AFTER_MS)).toBe(true)
  })
})

describe('AnimeMappingService', () =>
{
  it('reads a recent copy from disk without downloading', async () =>
  {
    writeCache(oldList, DAY_MS)
    expect(await AnimeMappingService.resolve('2')).toEqual({ tvdbId: '200', imdbId: 'tt0000002' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads and saves the list the first time it is needed', async () =>
  {
    serve(newList)
    expect(await AnimeMappingService.resolve('2')).toEqual({ tmdbId: '202' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual(newList)
    expect(fs.existsSync(`${cacheFile}.tmp`)).toBe(false)
  })

  it('answers from an old copy while the weekly update runs, then uses the new list', async () =>
  {
    writeCache(oldList, 8 * DAY_MS)
    serve(newList)
    expect(await AnimeMappingService.resolve('1')).toEqual({ tmdbId: '100' })

    const done = await AnimeMappingService.update()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(done).toMatchObject({ downloaded: true, titles: 3, updating: false })
    expect(done.error).toBeUndefined()
    expect(await AnimeMappingService.resolve('1')).toEqual({ tmdbId: '101' })
  })

  it('keeps an old copy as it is when automatic updates are off', async () =>
  {
    state.autoUpdate = false
    writeCache(oldList, 60 * DAY_MS)
    expect(await AnimeMappingService.resolve('1')).toEqual({ tmdbId: '100' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the old copy and reports the error when an update fails', async () =>
  {
    writeCache(oldList, DAY_MS)
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })

    const status = await AnimeMappingService.update()
    expect(status).toMatchObject({ downloaded: true, titles: 2, updating: false, error: 'HTTP 503' })
    expect(await AnimeMappingService.resolve('1')).toEqual({ tmdbId: '100' })
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual(oldList)
  })

  it('rejects a list with no AniDB entries without replacing the copy', async () =>
  {
    writeCache(oldList, DAY_MS)
    serve([{ themoviedb_id: 1 }])

    const status = await AnimeMappingService.update()
    expect(status.error).toMatch(/no AniDB entries/)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual(oldList)
  })

  it('reports the downloaded copy and its title count', async () =>
  {
    writeCache(oldList, 2 * DAY_MS)
    const status = await AnimeMappingService.status()
    expect(status).toMatchObject({ downloaded: true, titles: 2, updating: false })
    expect(Date.now() - Date.parse(status.updatedAt ?? '')).toBeGreaterThanOrEqual(2 * DAY_MS - 1000)
  })

  it('reports no copy before the first download', async () =>
  {
    expect(await AnimeMappingService.status()).toEqual({ downloaded: false, updatedAt: undefined, titles: undefined, updating: false, error: undefined })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('picks up a newer copy another process saved', async () =>
  {
    writeCache(oldList, 2 * DAY_MS)
    expect(await AnimeMappingService.resolve('1')).toEqual({ tmdbId: '100' })

    writeCache(newList, DAY_MS)
    expect(await AnimeMappingService.resolve('3')).toEqual({ tmdbId: '300' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
