import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const state = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const fs = require('fs') as typeof import('fs')
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pps-show-status-')), tmdbApiKey: '' as string }
})

vi.mock('../../electron/services/config', () => ({ ConfigService: { get: () => ({ tmdbApiKey: state.tmdbApiKey }) } }))
vi.mock('../../electron/services/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), session: vi.fn(), scrape: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../electron/runtime/paths', () => ({ getUserDataPath: () => state.dir }))

const { ShowStatusService, statusFromTmdb } = await import('../../electron/services/showStatusService')

const fetchMock = vi.fn()
const show = (key: string, tmdbId?: string) => ({ key, title: `Show ${key}`, tmdbId })
const tmdbReplies = (byId: Record<string, string>) =>
  fetchMock.mockImplementation(async (url: string) =>
  {
    const id = /\/tv\/(\d+)/.exec(url)?.[1]
    const status = id ? byId[id] : undefined
    return status ? { ok: true, json: async () => ({ status }) } : { ok: false, json: async () => ({}) }
  })
const resolveTmdbId = async (s: { tmdbId?: string }) => s.tmdbId ?? null
const fallback = (key: string) => (key === 'recent' ? 'continuing' as const : 'ended' as const)

beforeEach(() =>
{
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  ShowStatusService.reset()
  fs.rmSync(path.join(state.dir, 'show-status.json'), { force: true })
  state.tmdbApiKey = 'k'
})

afterEach(() =>
{
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('statusFromTmdb', () =>
{
  it('treats only finished or canceled shows as ended', () =>
  {
    expect(statusFromTmdb('Ended')).toBe('ended')
    expect(statusFromTmdb('Canceled')).toBe('ended')
    expect(statusFromTmdb('Returning Series')).toBe('continuing')
    expect(statusFromTmdb('In Production')).toBe('continuing')
    expect(statusFromTmdb(undefined)).toBe('continuing')
  })
})

describe('ShowStatusService.resolve', () =>
{
  it('asks TMDB once per show and uses the fallback for shows it cannot identify', async () =>
  {
    tmdbReplies({ '1972': 'Ended', '456': 'Returning Series' })

    const first = await ShowStatusService.resolve([show('a', '1972'), show('b', '456'), show('recent'), show('old')], { resolveTmdbId, fallback })
    expect([...first]).toEqual([['a', 'ended'], ['b', 'continuing'], ['recent', 'continuing'], ['old', 'ended']])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const second = await ShowStatusService.resolve([show('a', '1972'), show('b', '456'), show('recent')], { resolveTmdbId, fallback: () => 'ended' })
    expect([...second]).toEqual([['a', 'ended'], ['b', 'continuing'], ['recent', 'ended']])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('persists TMDB verdicts on disk and re-checks continuing shows sooner than ended ones', async () =>
  {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    tmdbReplies({ '1': 'Ended', '2': 'Returning Series' })
    await ShowStatusService.resolve([show('a', '1'), show('b', '2')], { resolveTmdbId, fallback })
    // writeFile creates the file before its contents land, so wait for the parsed entries.
    await vi.waitFor(() =>
    {
      const data = JSON.parse(fs.readFileSync(path.join(state.dir, 'show-status.json'), 'utf-8')) as { shows: Record<string, unknown> }
      expect(Object.keys(data.shows)).toHaveLength(2)
    })
    ShowStatusService.reset()

    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'))
    tmdbReplies({ '1': 'Ended', '2': 'Ended' })
    const after9Days = await ShowStatusService.resolve([show('a', '1'), show('b', '2')], { resolveTmdbId, fallback })
    expect([...after9Days]).toEqual([['a', 'ended'], ['b', 'ended']])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses only the fallback when no TMDB key is set', async () =>
  {
    state.tmdbApiKey = ''
    const result = await ShowStatusService.resolve([show('recent', '1'), show('old', '2')], { resolveTmdbId, fallback })
    expect([...result]).toEqual([['recent', 'continuing'], ['old', 'ended']])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
