import { describe, it, expect } from 'vitest'
import {
  buildRows, countLabel, dayLabel, emptyText, filterEntries, matchesQuery, matchesSeverity, mergeLive, timeOf,
  type ViewEntry,
} from '../features/logs/logView'
import { daysBefore, formatBytes, formatLogLine, localDay, normalizeRetentionDays } from '../../electron/services/logFormat'
import type { LogEntry } from '../../electron/ipc/types'

let id = 1
function entry(level: LogEntry['level'], message: string, ts: string, extra: Partial<LogEntry> = {}): ViewEntry
{
  return { id: id++, ts, level, module: 'Plex', message, ...extra }
}

describe('log filters', () =>
{
  const start = entry('info', 'started', '2026-11-09T08:00:00.000Z', { marker: 'start' })
  const info = entry('info', 'Connected', '2026-11-09T08:00:01.000Z')
  const warn = entry('warn', 'No sets found', '2026-11-09T08:00:02.000Z')
  const error = entry('error', 'Upload failed', '2026-11-09T08:00:03.000Z', { meta: { key: '90211' } })

  it('keeps launch markers in every severity', () =>
  {
    expect(matchesSeverity(start, 'error')).toBe(true)
    expect(matchesSeverity(info, 'warn')).toBe(false)
    expect(matchesSeverity(warn, 'warn')).toBe(true)
    expect(matchesSeverity(warn, 'error')).toBe(false)
  })

  it('searches source, message, and details without regard to case', () =>
  {
    expect(matchesQuery(error, 'upload')).toBe(true)
    expect(matchesQuery(error, '90211')).toBe(true)
    expect(matchesQuery(error, 'plex')).toBe(true)
    expect(matchesQuery(error, 'mediux')).toBe(false)
    expect(matchesQuery(error, '  ')).toBe(true)
  })

  it('combines the severity filter and the search', () =>
  {
    const all = [start, info, warn, error]
    expect(filterEntries(all, 'all', '')).toBe(all)
    expect(filterEntries(all, 'warn', '').map(e => e.message)).toEqual(['started', 'No sets found', 'Upload failed'])
    expect(filterEntries(all, 'warn', 'upload').map(e => e.message)).toEqual(['Upload failed'])
  })
})

describe('buildRows', () =>
{
  it('adds a heading wherever the local day changes and marks launches', () =>
  {
    const a = entry('info', 'a', new Date(2026, 10, 8, 23, 59).toISOString())
    const b = entry('info', 'started', new Date(2026, 10, 9, 0, 1).toISOString(), { marker: 'start' })
    const c = entry('info', 'c', new Date(2026, 10, 9, 0, 2).toISOString())
    expect(buildRows([a, b, c]).map(r => r.kind === 'day' ? `day ${r.day}` : r.kind)).toEqual(['day 2026-11-08', 'line', 'day 2026-11-09', 'start', 'line'])
  })
})

describe('labels', () =>
{
  const now = new Date(2026, 10, 9, 12)

  it('names today and yesterday, and dates further back', () =>
  {
    expect(dayLabel('2026-11-09', now)).toBe('Today')
    expect(dayLabel('2026-11-08', now)).toBe('Yesterday')
    expect(dayLabel('2026-11-02', now)).not.toMatch(/Today|Yesterday/)
  })

  it('formats time of day and counts', () =>
  {
    expect(timeOf(new Date(2026, 10, 9, 8, 2, 11).toISOString())).toBe('08:02:11')
    expect(timeOf('not a time')).toBe('not a time')
    expect(countLabel(1284, 1284)).toBe(`${(1284).toLocaleString()} lines`)
    expect(countLabel(12, 1284)).toBe(`12 of ${(1284).toLocaleString()} lines`)
    expect(countLabel(1, 1)).toBe('1 line')
  })

  it('explains an empty list by what hid the lines', () =>
  {
    expect(emptyText('all', 'tok', 10)).toBe('No lines match "tok".')
    expect(emptyText('error', '', 10)).toBe('No errors in these lines.')
    expect(emptyText('warn', '', 10)).toBe('No warnings or errors in these lines.')
    expect(emptyText('error', '', 0)).toBe('No log lines yet.')
  })
})

describe('mergeLive', () =>
{
  it('adds lines that arrived during the load without repeating any', () =>
  {
    const h = [entry('info', 'a', '2026-11-09T08:00:00.000Z'), entry('info', 'b', '2026-11-09T08:00:01.000Z')]
    const live = [entry('info', 'b', '2026-11-09T08:00:01.000Z'), entry('info', 'b2', '2026-11-09T08:00:01.000Z'), entry('info', 'c', '2026-11-09T08:00:02.000Z')]
    expect(mergeLive(h, live).map(e => e.message)).toEqual(['a', 'b', 'b2', 'c'])
    expect(mergeLive(h, [])).toBe(h)
  })
})

describe('logFormat', () =>
{
  it('accepts only the offered retention values', () =>
  {
    expect(normalizeRetentionDays(30)).toBe(30)
    expect(normalizeRetentionDays('7')).toBe(7)
    expect(normalizeRetentionDays(5)).toBe(14)
    expect(normalizeRetentionDays(undefined)).toBe(14)
  })

  it('steps back across month and year boundaries in local time', () =>
  {
    expect(daysBefore(new Date(2026, 2, 1, 9), 1)).toBe('2026-02-28')
    expect(daysBefore(new Date(2026, 0, 1, 9), 1)).toBe('2025-12-31')
    expect(localDay(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09')
  })

  it('formats sizes and plain-text lines', () =>
  {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    const line = formatLogLine({ ts: new Date(2026, 10, 9, 8, 2, 11).toISOString(), level: 'session', module: 'Scheduler', message: 'Running job "Nightly"' })
    expect(line).toBe('2026-11-09 08:02:11  JOB     [Scheduler] Running job "Nightly"')
  })
})
