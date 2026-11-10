import type { LogEntry } from '../../../electron/ipc/types'
import { localDay } from '../../../electron/services/logFormat'

/** How much of the log to show: everything, problems only, or errors only. */
export type Severity = 'all' | 'warn' | 'error'

/** A log entry with a stable key for rendering. */
export interface ViewEntry extends LogEntry
{
  id: number
}

/** One rendered row: a day heading, a launch marker, or a log line. */
export type LogRow =
  | { kind: 'day'; key: string; day: string }
  | { kind: 'start'; key: string; entry: ViewEntry }
  | { kind: 'line'; key: string; entry: ViewEntry }

function pad(n: number): string
{
  return String(n).padStart(2, '0')
}

/**
 * Tells whether an entry passes the severity filter. Launch markers always
 * pass, so a filtered view still shows where each launch began.
 *
 * @param entry - The entry.
 * @param severity - The chosen filter.
 * @returns True when the entry should show.
 */
export function matchesSeverity(entry: LogEntry, severity: Severity): boolean
{
  if (severity === 'all' || entry.marker === 'start') return true
  if (severity === 'error') return entry.level === 'error'
  return entry.level === 'error' || entry.level === 'warn'
}

/**
 * Tells whether an entry contains the search text in its source, message, or details.
 *
 * @param entry - The entry.
 * @param query - Search text; blank matches everything.
 * @returns True on a case-insensitive match.
 */
export function matchesQuery(entry: LogEntry, query: string): boolean
{
  const q = query.trim().toLowerCase()
  if (!q) return true
  const meta = entry.meta && Object.keys(entry.meta).length ? JSON.stringify(entry.meta) : ''
  return `${entry.module} ${entry.message} ${meta}`.toLowerCase().includes(q)
}

/**
 * Applies the severity filter and the search.
 *
 * @param entries - Loaded entries, oldest first.
 * @param severity - The chosen filter.
 * @param query - Search text.
 * @returns The entries that show.
 */
export function filterEntries(entries: ViewEntry[], severity: Severity, query: string): ViewEntry[]
{
  if (severity === 'all' && !query.trim()) return entries
  return entries.filter(e => matchesSeverity(e, severity) && matchesQuery(e, query))
}

/**
 * Lays entries out as rows, with a heading wherever the local day changes.
 *
 * @param entries - Entries that show, oldest first.
 * @returns Rows in display order.
 */
export function buildRows(entries: ViewEntry[]): LogRow[]
{
  const rows: LogRow[] = []
  let lastDay = ''
  for (const entry of entries)
  {
    const day = localDay(new Date(entry.ts))
    if (day !== lastDay)
    {
      rows.push({ kind: 'day', key: `day-${entry.id}`, day })
      lastDay = day
    }
    rows.push({ kind: entry.marker === 'start' ? 'start' : 'line', key: String(entry.id), entry } as LogRow)
  }
  return rows
}

/**
 * Names a day for a heading: "Today", "Yesterday", or a weekday and date.
 *
 * @param day - YYYY-MM-DD in local time.
 * @param now - The current time.
 * @returns The label.
 */
export function dayLabel(day: string, now = new Date()): string
{
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (day === localDay(now)) return 'Today'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (day === localDay(yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(y !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

/**
 * Formats an entry's time of day as HH:MM:SS in local time.
 *
 * @param ts - ISO timestamp.
 * @returns The time, or the raw value when it doesn't parse.
 */
export function timeOf(ts: string): string
{
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Formats an entry's full date and time for a tooltip.
 *
 * @param ts - ISO timestamp.
 * @returns A locale date and time.
 */
export function fullTime(ts: string): string
{
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })
}

/**
 * Counts lines for the toolbar.
 *
 * @param shown - Lines that pass the filters.
 * @param total - Lines loaded.
 * @returns "1,284 lines" or "12 of 1,284 lines".
 */
export function countLabel(shown: number, total: number): string
{
  const noun = total === 1 ? 'line' : 'lines'
  return shown === total ? `${total.toLocaleString()} ${noun}` : `${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}`
}

/**
 * Explains an empty list.
 *
 * @param severity - The chosen filter.
 * @param query - Search text.
 * @param loaded - Lines loaded before filtering.
 * @returns The message.
 */
export function emptyText(severity: Severity, query: string, loaded: number): string
{
  if (query.trim()) return `No lines match "${query.trim()}".`
  if (!loaded) return 'No log lines yet.'
  return severity === 'error' ? 'No errors in these lines.' : 'No warnings or errors in these lines.'
}

/**
 * Adds lines that streamed in while history was loading, without repeating
 * any that the history already holds.
 *
 * @param history - Loaded lines, oldest first.
 * @param live - Lines received during the load, in order.
 * @returns The combined lines.
 */
export function mergeLive(history: LogEntry[], live: LogEntry[]): LogEntry[]
{
  if (!live.length) return history
  const last = history.length ? history[history.length - 1].ts : ''
  const seen = new Set(history.filter(e => e.ts >= last).map(e => `${e.ts}|${e.level}|${e.message}`))
  const fresh = live.filter(e => e.ts > last || (e.ts === last && !seen.has(`${e.ts}|${e.level}|${e.message}`)))
  return fresh.length ? [...history, ...fresh] : history
}
