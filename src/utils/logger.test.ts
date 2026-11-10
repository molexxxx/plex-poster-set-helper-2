import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pps-logs-')) }

vi.mock('../../electron/runtime/paths', () => ({ getLogPath: () => state.dir }))
vi.mock('../../electron/runtime/runtime', () => ({ getAppVersion: () => '9.9.9', isDockerEnv: () => false, isWebMode: () => false }))
vi.mock('../../electron/runtime/events', () => ({ appEvents: { emitEvent: vi.fn() } }))

const { Logger, filesToPrune, redactSecrets } = await import('../../electron/services/logger')
const { localDay, daysBefore } = await import('../../electron/services/logFormat')

const MB = 1024 * 1024
const today = localDay(new Date())
const yesterday = daysBefore(new Date(), 1)

function writeDay(day: string, messages: string[]): void
{
  const lines = messages.map((message, i) => JSON.stringify({ ts: `${day}T10:00:${String(i).padStart(2, '0')}.000Z`, level: 'info', module: 'Test', message }))
  fs.writeFileSync(path.join(state.dir, `app-${day}.log`), `${lines.join('\n')}\n`)
}

function files(): string[]
{
  return fs.readdirSync(state.dir).sort()
}

beforeEach(() =>
{
  for (const name of fs.readdirSync(state.dir)) fs.rmSync(path.join(state.dir, name), { force: true })
})

afterEach(() =>
{
  Logger.close()
})

afterAll(() =>
{
  fs.rmSync(state.dir, { recursive: true, force: true })
})

describe('filesToPrune', () =>
{
  const now = new Date(2026, 10, 10, 12)
  const day = (back: number) => daysBefore(now, back)
  const file = (back: number, bytes = 1000, legacy = false) => ({ name: legacy ? `app${back}.log` : `app-${day(back)}.log`, day: day(back), bytes, legacy })

  it('deletes days outside the retention window, counting today as the first day', () =>
  {
    const all = [0, 1, 6, 7, 13, 14, 30].map(back => file(back))
    expect(filesToPrune(all, now, 7, 100 * MB).sort()).toEqual([`app-${day(14)}.log`, `app-${day(30)}.log`, `app-${day(7)}.log`, `app-${day(13)}.log`].sort())
  })

  it('trims the oldest days until the total fits, but never today', () =>
  {
    const all = [file(0, 60 * MB), file(1, 30 * MB), file(2, 30 * MB), file(3, 30 * MB)]
    expect(filesToPrune(all, now, 90, 100 * MB).sort()).toEqual([`app-${day(2)}.log`, `app-${day(3)}.log`].sort())
    expect(filesToPrune([file(0, 150 * MB)], now, 90, 100 * MB)).toEqual([])
  })

  it('dates older-format files by when they were written and trims them before a daily file of the same day', () =>
  {
    const legacy = file(20, 1000, true)
    expect(filesToPrune([file(0), legacy], now, 14, 100 * MB)).toEqual([legacy.name])
    const sameDay = [file(0, 60 * MB), file(5, 30 * MB, true), file(5, 30 * MB)]
    expect(filesToPrune(sameDay, now, 14, 100 * MB)).toEqual(['app5.log'])
  })
})

describe('redactSecrets', () =>
{
  it('blanks tokens and API keys in query strings', () =>
  {
    expect(redactSecrets('GET http://plex:32400/a?X-Plex-Token=abc123&b=1 failed')).toBe('GET http://plex:32400/a?X-Plex-Token=[redacted]&b=1 failed')
    expect(redactSecrets('https://api.themoviedb.org/3/tv/1?api_key=secret')).toBe('https://api.themoviedb.org/3/tv/1?api_key=[redacted]')
    expect(redactSecrets('no secrets here')).toBe('no secrets here')
  })
})

describe('Logger', () =>
{
  it('writes a launch marker first, then entries logged before and after it started', () =>
  {
    Logger.warn('Config', 'logged before init')
    const sent: unknown[] = []
    Logger.init({ console: false, broadcast: e => sent.push(e) })
    Logger.info('Plex', 'Connected')

    expect(files()).toEqual([`app-${today}.log`])
    const { entries } = Logger.history()
    expect(entries.map(e => e.message)).toEqual(['Plex Poster Set Helper 2 v9.9.9 started on ' + ({ win32: 'Windows', linux: 'Linux', darwin: 'macOS' } as Record<string, string>)[process.platform], 'logged before init', 'Connected'])
    expect(entries[0].marker).toBe('start')
    expect(sent).toHaveLength(2)
  })

  it('streams each entry to windows exactly once', () =>
  {
    const sent: unknown[] = []
    Logger.init({ console: false, broadcast: e => sent.push(e) })
    sent.length = 0
    Logger.info('A', 'one')
    Logger.error('A', 'two')
    expect(sent).toHaveLength(2)
  })

  it('redacts secrets before writing or streaming', () =>
  {
    const sent: Array<{ message: string; meta?: Record<string, unknown> }> = []
    Logger.init({ console: false, broadcast: e => sent.push(e) })
    Logger.error('Plex', 'Upload failed: http://plex/x?X-Plex-Token=abc', { url: 'http://plex/y?X-Plex-Token=def' })
    const last = sent[sent.length - 1]
    expect(last.message).toContain('X-Plex-Token=[redacted]')
    expect(JSON.stringify(last.meta)).toContain('X-Plex-Token=[redacted]')
    expect(fs.readFileSync(path.join(state.dir, `app-${today}.log`), 'utf8')).not.toMatch(/abc|def/)
  })

  it('pages back through days with a cursor, oldest line first in each page', () =>
  {
    writeDay(yesterday, ['y1', 'y2', 'y3'])
    writeDay(today, ['t1', 't2'])
    Logger.init({ console: false })
    const messages = (page: { entries: Array<{ message: string }> }) => page.entries.map(e => (e.message.includes('started') ? 'start' : e.message))

    const first = Logger.history({ limit: 2 })
    expect(messages(first)).toEqual(['t2', 'start'])
    const second = Logger.history({ limit: 2, cursor: first.cursor })
    expect(messages(second)).toEqual(['y3', 't1'])
    const third = Logger.history({ limit: 2, cursor: second.cursor })
    expect(messages(third)).toEqual(['y1', 'y2'])
    expect(third.cursor).toBeUndefined()
  })

  it('reads a single day and ignores days that are not dates', () =>
  {
    writeDay(yesterday, ['y1', 'y2'])
    Logger.init({ console: false })
    expect(Logger.history({ day: yesterday }).entries.map(e => e.message)).toEqual(['y1', 'y2'])
    expect(Logger.history({ day: '../../etc/passwd' }).entries).toEqual([])
  })

  it('skips lines that are not valid entries', () =>
  {
    fs.writeFileSync(path.join(state.dir, `app-${yesterday}.log`), `{"ts":"x","level":"info","module":"A","message":"ok"}\nnot json\n{"partial":\n`)
    Logger.init({ console: false })
    expect(Logger.history({ day: yesterday }).entries.map(e => e.message)).toEqual(['ok'])
  })

  it('reports kept days, newest first, and their sizes', () =>
  {
    writeDay(yesterday, ['y1'])
    Logger.init({ console: false, retentionDays: 30 })
    const s = Logger.status()
    expect(s.days.map(d => d.day)).toEqual([today, yesterday])
    expect(s.retentionDays).toBe(30)
    expect(s.totalBytes).toBe(s.days.reduce((sum, d) => sum + d.bytes, 0))
  })

  it('deletes days outside a shorter retention as soon as it changes', () =>
  {
    const old = daysBefore(new Date(), 10)
    writeDay(old, ['old'])
    Logger.init({ console: false, retentionDays: 14 })
    expect(files()).toContain(`app-${old}.log`)
    Logger.setRetention(7)
    expect(files()).not.toContain(`app-${old}.log`)
  })

  it('falls back to 14 days for an unknown retention value', () =>
  {
    Logger.init({ console: false, retentionDays: 5 })
    expect(Logger.status().retentionDays).toBe(14)
  })

  it('clears every file, older-format ones included, and notes it', () =>
  {
    writeDay(yesterday, ['y1'])
    fs.writeFileSync(path.join(state.dir, 'app.log'), 'old format\n')
    fs.writeFileSync(path.join(state.dir, 'app1.log'), 'old format\n')
    Logger.init({ console: false })
    Logger.clear()
    expect(files()).toEqual([`app-${today}.log`])
    expect(Logger.history().entries.map(e => e.message)).toEqual(['Logs cleared'])
  })

  it('summarizes the newest warnings and errors for a bug report', () =>
  {
    Logger.init({ console: false })
    Logger.info('A', 'fine')
    Logger.warn('PosterDB', 'No sets found')
    Logger.error('Plex', 'Upload failed')
    const text = Logger.diagnostics()
    expect(text).toContain('Plex Poster Set Helper 2 v9.9.9')
    expect(text).toContain('Newest 2 warnings and errors:')
    expect(text.indexOf('No sets found')).toBeLessThan(text.indexOf('Upload failed'))
    expect(text).not.toContain('fine')
  })

  it('exports kept days as plain text, oldest first', () =>
  {
    writeDay(yesterday, ['y1'])
    Logger.init({ console: false })
    Logger.error('Plex', 'Upload failed', { key: '1' })
    const text = Logger.exportText()
    expect(text.indexOf('[Test] y1')).toBeGreaterThan(0)
    expect(text).toMatch(/ERROR\s+\[Plex\] Upload failed \{"key":"1"\}/)
    expect(text.indexOf('y1')).toBeLessThan(text.indexOf('Upload failed'))
    expect(Logger.exportFileName(yesterday)).toBe(`plex-poster-set-helper-logs-${yesterday}.txt`)
    expect(Logger.exportFileName('bad')).toBe(`plex-poster-set-helper-logs-${today}.txt`)
  })
})
