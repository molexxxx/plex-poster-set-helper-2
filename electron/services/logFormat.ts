import type { LogEntry } from '../ipc/types'

/** Day counts offered for keeping log files. */
export const LOG_RETENTION_OPTIONS = [1, 3, 7, 14, 30, 90] as const
export const DEFAULT_LOG_RETENTION_DAYS = 14
/** Log files are trimmed, oldest day first, to stay under this total. */
export const LOG_MAX_BYTES = 100 * 1024 * 1024

/** Short names for each level, as shown in viewers and exported text. */
export const LOG_LEVEL_LABELS: Record<LogEntry['level'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  success: 'OK',
  session: 'JOB',
  scrape: 'DETAIL',
  debug: 'DEBUG',
  verbose: 'TRACE',
}

/**
 * Clamps a stored retention value to one of the offered day counts.
 *
 * @param value - The configured value, possibly missing or invalid.
 * @returns A day count from LOG_RETENTION_OPTIONS.
 */
export function normalizeRetentionDays(value: unknown): number
{
  const n = typeof value === 'number' ? value : Number(value)
  return (LOG_RETENTION_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_LOG_RETENTION_DAYS
}

function pad(n: number, width = 2): string
{
  return String(n).padStart(width, '0')
}

/**
 * Formats a date as YYYY-MM-DD in local time, the key log files are named by.
 *
 * @param date - The moment to convert.
 * @returns The local calendar day.
 */
export function localDay(date: Date): string
{
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Returns the local calendar day a number of days before another.
 *
 * @param date - The starting moment.
 * @param days - How many days to step back.
 * @returns The earlier day as YYYY-MM-DD.
 */
export function daysBefore(date: Date, days: number): string
{
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - days)
  return localDay(d)
}

/**
 * Formats a byte count for people, such as "4.2 MB".
 *
 * @param bytes - The size.
 * @returns The size with a unit.
 */
export function formatBytes(bytes: number): string
{
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace(/\.0$/, '')} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}

/**
 * Renders one entry as a plain-text line in local time, for copying and saved files.
 *
 * @param entry - The log entry.
 * @returns A line such as "2026-11-09 08:02:11  ERROR   [Plex] Upload failed".
 */
export function formatLogLine(entry: LogEntry): string
{
  const d = new Date(entry.ts)
  const when = Number.isNaN(d.getTime())
    ? entry.ts
    : `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const level = (LOG_LEVEL_LABELS[entry.level] ?? String(entry.level).toUpperCase()).padEnd(6)
  const meta = entry.meta && Object.keys(entry.meta).length ? ` ${JSON.stringify(entry.meta)}` : ''
  return `${when}  ${level}  [${entry.module}] ${entry.message}${meta}`
}
