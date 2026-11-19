import { useCallback, useEffect, useState } from 'react'
import { copyText } from '../../../utils/clipboard'
import { formatLogLine } from '../../../../electron/services/logFormat'
import type { LogEntry, LogStatus } from '../../../../electron/ipc/types'
import { countLabel, errorText } from '../logView'
import type { NoticeTone } from './useLogNotice'

interface LogActionsOptions
{
  /** The viewer offers the day picker, so it keeps the day list current. */
  pickDays: boolean
  day: string
  setDay: (day: string) => void
  reload: () => void
  /** The lines that show, which Copy copies. */
  visible: LogEntry[]
  notify: (text: string, tone?: NoticeTone) => void
  announce: (message: string) => void
}

/**
 * The log viewer's actions: copying the lines shown, copying diagnostics,
 * saving a copy, and clearing every log file, with the day list the picker
 * and the clear confirmation read.
 *
 * @param options - The viewer state the actions read and change.
 * @returns The day list, whether this is the web UI, the copy and confirm
 *   state, and the actions.
 */
export function useLogActions({ pickDays, day, setDay, reload, visible, notify, announce }: LogActionsOptions)
{
  const [status, setStatus] = useState<LogStatus | null>(null)
  const [isWeb, setIsWeb] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const refreshStatus = useCallback(() =>
  {
    window.api.log.status().then(setStatus).catch(() => { /* the day picker keeps its last list */ })
  }, [])

  useEffect(() =>
  {
    window.api.app.getEnv().then(env => setIsWeb(!!env.web)).catch(() => { /* assume desktop */ })
    if (pickDays) refreshStatus()
  }, [pickDays, refreshStatus])

  async function copyVisible()
  {
    const ok = await copyText(visible.map(formatLogLine).join('\n'))
    if (!ok)
    {
      notify('Copying was blocked by the browser. Select the lines and press Ctrl+C instead.', 'error')
      return
    }
    setCopied(true)
    announce(`Copied ${countLabel(visible.length, visible.length)}`)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyDiagnostics()
  {
    try
    {
      const ok = await copyText(await window.api.log.diagnostics())
      if (ok) notify('Diagnostics copied. Check them before posting publicly: error lines can include your Plex server address and folder paths.', 'warn')
      else notify('Copying was blocked by the browser.', 'error')
    }
    catch (err)
    {
      notify(`Diagnostics could not be read: ${errorText(err)}`, 'error')
    }
  }

  async function saveCopy()
  {
    try
    {
      const res = await window.api.log.exportCopy(day === 'latest' ? undefined : { day })
      if (res.saved && res.path) notify(`Saved to ${res.path}`)
    }
    catch (err)
    {
      notify(`The logs could not be saved: ${errorText(err)}`, 'error')
    }
  }

  async function clearLogs()
  {
    setConfirmClear(false)
    try
    {
      await window.api.log.clear()
      notify('Logs cleared')
      if (day !== 'latest') setDay('latest')
      reload()
      if (pickDays) refreshStatus()
    }
    catch (err)
    {
      notify(`The logs could not be cleared: ${errorText(err)}`, 'error')
    }
  }

  return { status, isWeb, copied, confirmClear, setConfirmClear, refreshStatus, copyVisible, copyDiagnostics, saveCopy, clearLogs }
}
