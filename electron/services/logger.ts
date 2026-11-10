import winston from 'winston'
import path from 'path'
import fs from 'fs'
import os from 'os'
import type { LogEntry, LogHistoryReq, LogHistoryPage, LogStatus } from '../ipc/types'
import { getLogPath } from '../runtime/paths'
import { appEvents } from '../runtime/events'
import { getAppVersion, isDockerEnv, isWebMode } from '../runtime/runtime'
import { LOG_MAX_BYTES, daysBefore, formatBytes, formatLogLine, localDay, normalizeRetentionDays } from './logFormat'

const CUSTOM_LEVELS = {
  levels: { error: 0, warn: 1, info: 2, success: 3, session: 4, scrape: 5, debug: 6, verbose: 7 },
  colors: { error: 'red', warn: 'yellow', info: 'cyan', success: 'green', session: 'magenta', scrape: 'blue', debug: 'white', verbose: 'gray' },
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_FILE = /^app-(\d{4}-\d{2}-\d{2})\.log$/
/** Files from before daily logs: app.log and its size-rotated copies. */
const LEGACY_FILE = /^app\d*\.log$/
const SECRET_PARAM = /([?&](?:X-Plex-Token|api_key|apikey|token)=)[^&\s"']+/gi
const PAGE_SIZE = 1000
const PAGE_MAX = 5000
const EARLY_MAX = 1000
const PRUNE_EVERY = 5000
const DIAGNOSTIC_LINES = 50

/** A log file on disk, dated by its name or, for older-format files, by when it was last written. */
export interface LogFile
{
  name: string
  day: string
  bytes: number
  legacy: boolean
}

interface InitOptions
{
  /** Sends each new entry to open windows. */
  broadcast?: (entry: LogEntry) => void
  retentionDays?: number
  /** Mirror entries to stdout, which `docker logs` reads (default true). */
  console?: boolean
}

let consoleLogger: winston.Logger | null = null
let broadcast: ((entry: LogEntry) => void) | null = null
let dir: string | null = null
let fd: number | null = null
let fdDay: string | null = null
let retentionDays = normalizeRetentionDays(undefined)
let writesSincePrune = 0
const early: LogEntry[] = []

/**
 * Picks the log files to delete: days older than the retention window, then
 * the oldest of the rest until the total fits under the size cap. Today's
 * file is never deleted.
 *
 * @param files - Every log file on disk.
 * @param now - The current time.
 * @param keepDays - Days to keep, today included.
 * @param maxBytes - Total size to trim to.
 * @returns Names of the files to delete.
 */
export function filesToPrune(files: LogFile[], now: Date, keepDays: number, maxBytes: number): string[]
{
  const today = localDay(now)
  const cutoff = daysBefore(now, keepDays - 1)
  const doomed = new Set<string>()
  for (const f of files)
  {
    if (f.day < cutoff && f.day !== today) doomed.add(f.name)
  }
  let total = files.reduce((sum, f) => sum + (doomed.has(f.name) ? 0 : f.bytes), 0)
  const oldestFirst = files
    .filter(f => !doomed.has(f.name) && f.day !== today)
    .sort((a, b) => a.day.localeCompare(b.day) || Number(b.legacy) - Number(a.legacy))
  for (const f of oldestFirst)
  {
    if (total <= maxBytes) break
    doomed.add(f.name)
    total -= f.bytes
  }
  return [...doomed]
}

/**
 * Blanks tokens and API keys carried in URL query strings.
 *
 * @param text - Text that may contain URLs.
 * @returns The text with secret values replaced.
 */
export function redactSecrets(text: string): string
{
  return text.replace(SECRET_PARAM, '$1[redacted]')
}

function redactMeta(meta: Record<string, unknown>): Record<string, unknown>
{
  try
  {
    const json = JSON.stringify(meta)
    const clean = redactSecrets(json)
    return clean === json ? meta : JSON.parse(clean) as Record<string, unknown>
  }
  catch
  {
    return meta
  }
}

function runtimeLabel(): string
{
  if (isDockerEnv()) return 'in Docker'
  if (isWebMode()) return 'as a web server'
  const names: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }
  return `on ${names[process.platform] ?? process.platform}`
}

function dayFileName(day: string): string
{
  return `app-${day}.log`
}

function validDay(day: string | undefined): string | undefined
{
  return day && DAY_PATTERN.test(day) ? day : undefined
}

function listFiles(): LogFile[]
{
  if (!dir) return []
  let names: string[]
  try
  {
    names = fs.readdirSync(dir)
  }
  catch
  {
    return []
  }
  const out: LogFile[] = []
  for (const name of names)
  {
    const daily = DAY_FILE.exec(name)
    if (!daily && !LEGACY_FILE.test(name)) continue
    try
    {
      const stat = fs.statSync(path.join(dir, name))
      out.push({ name, day: daily ? daily[1] : localDay(stat.mtime), bytes: stat.size, legacy: !daily })
    }
    catch
    {
      continue
    }
  }
  return out
}

function keptDays(): string[]
{
  return listFiles().filter(f => !f.legacy).map(f => f.day).sort().reverse()
}

function closeFile(): void
{
  if (fd != null)
  {
    try
    {
      fs.closeSync(fd)
    }
    catch
    {
      /* already closed */
    }
  }
  fd = null
  fdDay = null
}

function prune(): void
{
  writesSincePrune = 0
  if (!dir) return
  for (const name of filesToPrune(listFiles(), new Date(), retentionDays, LOG_MAX_BYTES))
  {
    try
    {
      fs.unlinkSync(path.join(dir, name))
    }
    catch
    {
      /* in use or already gone */
    }
  }
}

function persist(entry: LogEntry): void
{
  if (!dir)
  {
    early.push(entry)
    if (early.length > EARLY_MAX) early.shift()
    return
  }
  const day = localDay(new Date(entry.ts))
  if (day !== fdDay || fd == null)
  {
    closeFile()
    try
    {
      fd = fs.openSync(path.join(dir, dayFileName(day)), 'a')
      fdDay = day
    }
    catch
    {
      return
    }
    prune()
  }
  const handle = fd
  if (handle == null) return
  try
  {
    fs.writeSync(handle, `${JSON.stringify(entry)}\n`)
  }
  catch
  {
    return
  }
  if (++writesSincePrune >= PRUNE_EVERY) prune()
}

function readLines(day: string): string[]
{
  if (!dir) return []
  try
  {
    const lines = fs.readFileSync(path.join(dir, dayFileName(day)), 'utf8').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines
  }
  catch
  {
    return []
  }
}

function parseLine(line: string): LogEntry | null
{
  try
  {
    const e = JSON.parse(line) as Partial<LogEntry>
    if (typeof e.ts !== 'string' || typeof e.level !== 'string' || typeof e.message !== 'string') return null
    return { ...e, module: typeof e.module === 'string' ? e.module : '' } as LogEntry
  }
  catch
  {
    return null
  }
}

function parseCursor(cursor: string | undefined): { day: string; line: number } | null
{
  const m = cursor ? /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(cursor) : null
  return m ? { day: m[1], line: Number(m[2]) } : null
}

/**
 * Writes one file of JSON lines per local day under the log folder, keeps
 * the days the user chose (and at most LOG_MAX_BYTES in all), mirrors entries
 * to stdout, and streams each new entry to open windows once.
 */
export const Logger = {
  init(options: InitOptions = {}): void
  {
    broadcast = options.broadcast ?? null
    retentionDays = normalizeRetentionDays(options.retentionDays)
    consoleLogger = options.console === false ? null : winston.createLogger({
      levels: CUSTOM_LEVELS.levels,
      level: 'verbose',
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ colors: CUSTOM_LEVELS.colors }),
            winston.format.simple(),
          ),
        }),
      ],
    })
    try
    {
      dir = getLogPath()
    }
    catch
    {
      dir = null
    }
    const pending = early.splice(0)
    const start: LogEntry = {
      ts: pending[0]?.ts ?? new Date().toISOString(),
      level: 'info',
      module: 'App',
      message: `Plex Poster Set Helper 2 v${getAppVersion()} started ${runtimeLabel()}`,
      marker: 'start',
    }
    persist(start)
    for (const entry of pending) persist(entry)
    appEvents.emitEvent('log:stream', start)
    broadcast?.(start)
  },

  log(level: LogEntry['level'], module: string, message: string, meta?: Record<string, unknown>): void
  {
    const entry: LogEntry = { ts: new Date().toISOString(), level, module, message: redactSecrets(message) }
    if (meta && Object.keys(meta).length) entry.meta = redactMeta(meta)
    const write = consoleLogger as unknown as Record<string, ((msg: string, meta?: object) => void) | undefined> | null
    write?.[level]?.(entry.message, { module, ...entry.meta })
    persist(entry)
    appEvents.emitEvent('log:stream', entry)
    broadcast?.(entry)
  },

  /**
   * Reads saved lines, newest page first.
   *
   * @param req - A day to read, a cursor from the previous page, and a page size.
   * @returns The lines, oldest first, and a cursor when earlier lines exist.
   */
  history(req: LogHistoryReq = {}): LogHistoryPage
  {
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(req.limit ?? PAGE_SIZE)))
    const only = validDay(req.day)
    if (req.day && !only) return { entries: [] }
    const days = only ? [only] : keptDays()
    const cursor = parseCursor(req.cursor)
    const newestFirst: LogEntry[] = []
    for (let d = 0; d < days.length; d++)
    {
      const day = days[d]
      if (cursor && day > cursor.day) continue
      const lines = readLines(day)
      let i = cursor && cursor.day === day ? Math.min(cursor.line, lines.length) : lines.length
      while (i > 0)
      {
        i--
        const entry = parseLine(lines[i])
        if (!entry) continue
        newestFirst.push(entry)
        if (newestFirst.length === limit)
        {
          const more = i > 0 || d < days.length - 1
          return { entries: newestFirst.reverse(), cursor: more ? `${day}:${i}` : undefined }
        }
      }
    }
    return { entries: newestFirst.reverse() }
  },

  /** The kept days, their sizes, and the limits they are kept to. */
  status(): LogStatus
  {
    const files = listFiles()
    return {
      days: files.filter(f => !f.legacy).sort((a, b) => b.day.localeCompare(a.day)).map(f => ({ day: f.day, bytes: f.bytes })),
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      retentionDays,
      maxBytes: LOG_MAX_BYTES,
    }
  },

  /**
   * Changes how many days of logs are kept and deletes any days now outside it.
   *
   * @param days - One of LOG_RETENTION_OPTIONS.
   */
  setRetention(days: unknown): void
  {
    retentionDays = normalizeRetentionDays(days)
    prune()
  },

  /** Deletes every log file, older-format files included. */
  clear(): void
  {
    closeFile()
    for (const f of listFiles())
    {
      try
      {
        if (dir) fs.unlinkSync(path.join(dir, f.name))
      }
      catch
      {
        /* in use or already gone */
      }
    }
    Logger.info('App', 'Logs cleared')
  },

  /**
   * Summarizes the app and its newest warnings and errors for a bug report.
   *
   * @returns Plain text: version, runtime, log retention, and up to 50 problem lines.
   */
  diagnostics(): string
  {
    const s = Logger.status()
    const problems: LogEntry[] = []
    for (const day of keptDays())
    {
      const lines = readLines(day)
      for (let i = lines.length - 1; i >= 0 && problems.length < DIAGNOSTIC_LINES; i--)
      {
        const e = parseLine(lines[i])
        if (e && (e.level === 'error' || e.level === 'warn')) problems.push(e)
      }
      if (problems.length >= DIAGNOSTIC_LINES) break
    }
    const oldest = s.days.length ? s.days[s.days.length - 1].day : undefined
    const versions = [process.versions.electron ? `Electron ${process.versions.electron}` : '', `Node ${process.versions.node}`]
      .filter(Boolean)
      .join(', ')
    return [
      `Plex Poster Set Helper 2 v${getAppVersion()}`,
      `Runtime: ${runtimeLabel().replace(/^(on|in|as) /, '')} (${process.platform} ${os.release()} ${process.arch}; ${versions})`,
      `Logs: kept ${s.retentionDays} days, ${formatBytes(s.totalBytes)}${oldest ? ` since ${oldest}` : ''}`,
      '',
      problems.length ? `Newest ${problems.length} warnings and errors:` : 'No warnings or errors in the kept logs.',
      ...problems.reverse().map(formatLogLine),
    ].join('\n')
  },

  /**
   * Renders kept logs as plain text in local time.
   *
   * @param day - One day to include; omitted includes every kept day.
   * @returns The text, oldest line first.
   */
  exportText(day?: string): string
  {
    const only = validDay(day)
    const days = only ? [only] : keptDays().reverse()
    const out = [`Plex Poster Set Helper 2 v${getAppVersion()} logs, saved ${new Date().toISOString()}`, '']
    for (const d of days)
    {
      for (const line of readLines(d))
      {
        const e = parseLine(line)
        if (e) out.push(formatLogLine(e))
      }
    }
    return `${out.join('\n')}\n`
  },

  /**
   * Names a saved copy of the logs.
   *
   * @param day - The day saved, if only one.
   * @returns A file name such as plex-poster-set-helper-logs-2026-11-09.txt.
   */
  exportFileName(day?: string): string
  {
    return `plex-poster-set-helper-logs-${validDay(day) ?? localDay(new Date())}.txt`
  },

  /** Closes the open log file and forgets all state. Used by tests and shutdown. */
  close(): void
  {
    closeFile()
    consoleLogger = null
    broadcast = null
    dir = null
    early.length = 0
    writesSincePrune = 0
  },

  error: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('error', module, msg, meta),
  warn: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('warn', module, msg, meta),
  info: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('info', module, msg, meta),
  success: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('success', module, msg, meta),
  debug: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('debug', module, msg, meta),
  scrape: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('scrape', module, msg, meta),
  session: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('session', module, msg, meta),
}
