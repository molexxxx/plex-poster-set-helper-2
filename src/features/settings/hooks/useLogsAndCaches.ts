import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogStatus } from '../../../../electron/ipc/types'
import type { SettingsConfig } from './useSettingsConfig'

/**
 * Saved log files and cached data: the log status while the Advanced group is
 * open, how long logs are kept, saving a copy, and clearing either.
 *
 * @param active - Whether the Advanced group is showing.
 * @param announce - Reads a result out to screen readers.
 * @param setCfg - Updates the page's config copy when the retention changes.
 * @returns The log status, the result flags and note, and the actions.
 */
export function useLogsAndCaches(active: boolean, announce: (message: string) => void, setCfg: SettingsConfig['setCfg'])
{
  const [logStatus, setLogStatus]           = useState<LogStatus | null>(null)
  const [logsCleared, setLogsCleared]       = useState(false)
  const [logsSaved, setLogsSaved]           = useState(false)
  const [logFilesNote, setLogFilesNote]     = useState<{ text: string; error: boolean } | null>(null)
  const logFilesNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cachesCleared, setCachesCleared]   = useState(false)
  const [clearingCaches, setClearingCaches] = useState(false)

  const loadLogStatus = useCallback(() =>
  {
    window.api.log.status().then(setLogStatus).catch(() => { /* the row keeps its last status */ })
  }, [])

  useEffect(() =>
  {
    if (!active) return
    let live = true
    window.api.log.status()
      .then(status => { if (live) setLogStatus(status) })
      .catch(() => { /* the row keeps its last status */ })
    return () => { live = false }
  }, [active])

  async function clearLogs()
  {
    try
    {
      await window.api.log.clear()
      setLogsCleared(true)
      announce('Logs cleared')
      setTimeout(() => setLogsCleared(false), 2500)
      loadLogStatus()
    }
    catch (err)
    {
      showLogFilesNote(`The logs could not be cleared: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  async function setLogRetention(days: number)
  {
    setCfg(prev => prev ? { ...prev, logRetentionDays: days } : prev)
    try
    {
      await window.api.config.set({ logRetentionDays: days })
      loadLogStatus()
    }
    catch
    {
      /* the next status read shows what was kept */
    }
  }

  function showLogFilesNote(text: string, error: boolean)
  {
    if (logFilesNoteTimer.current) clearTimeout(logFilesNoteTimer.current)
    setLogFilesNote({ text, error })
    announce(text)
    logFilesNoteTimer.current = setTimeout(() => setLogFilesNote(null), error ? 12000 : 6000)
  }

  async function saveLogCopy()
  {
    try
    {
      const res = await window.api.log.exportCopy()
      if (!res.saved || !res.path) return
      setLogsSaved(true)
      setTimeout(() => setLogsSaved(false), 2500)
      showLogFilesNote(`Saved to ${res.path}`, false)
    }
    catch (err)
    {
      showLogFilesNote(`The logs could not be saved: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  async function clearCaches() {
    setClearingCaches(true)
    try {
      await window.api.app.clearCaches()
      setCachesCleared(true)
      announce('Cached data cleared. It is read again on next use.')
      setTimeout(() => setCachesCleared(false), 4000)
    } finally {
      setClearingCaches(false)
    }
  }

  return { logStatus, logsCleared, logsSaved, logFilesNote, cachesCleared, clearingCaches, clearLogs, setLogRetention, saveLogCopy, clearCaches }
}

/** The log and cache state and actions `useLogsAndCaches` returns. */
export type LogsAndCaches = ReturnType<typeof useLogsAndCaches>
