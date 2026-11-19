import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserInstallError, BrowserInstallState, BrowserStatus, SystemBrowser } from '../../../../electron/ipc/types'
import { copyText } from '../../../utils/clipboard'
import { FALLBACK_ERROR } from '../setupText'

/** Where first-run setup stands. */
export type Phase = 'checking' | 'installing' | 'verifying' | 'done' | 'tmdb' | 'error'

/**
 * First-run browser setup: checks the browser, verifies or installs it, and
 * recovers from a failure by retrying or switching to a browser already on
 * the machine. Once a browser is ready it moves on to the TMDB key step,
 * unless a key is already set.
 *
 * @param onComplete - Called when setup is finished or skipped.
 * @returns The phase, the install state and its log, the failure, the
 *   browsers found on the machine, and the actions the screen offers.
 */
export function useBrowserSetup(onComplete: () => void)
{
  const [phase, setPhase] = useState<Phase>('checking')
  const [install, setInstall] = useState<BrowserInstallState | null>(null)
  const [error, setError] = useState<BrowserInstallError | null>(null)
  const [systemBrowsers, setSystemBrowsers] = useState<SystemBrowser[]>([])
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const finishedRef = useRef(false)

  const appendLog = useCallback((line: string) =>
  {
    setLog(prev => [...prev.slice(-120), line])
    requestAnimationFrame(() =>
    {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }, [])

  // After the browser is ready, offer the optional TMDB key step, but only when
  // a key isn't already configured (returning users skip straight through).
  const proceedAfterBrowser = useCallback(async (delayMs: number) =>
  {
    if (finishedRef.current) return
    finishedRef.current = true
    const cfg = await window.api.config.get()
    const hasKey = (cfg.tmdbApiKey ?? '').trim().length > 0
    setTimeout(() => (hasKey ? onComplete() : setPhase('tmdb')), delayMs)
  }, [onComplete])

  const succeed = useCallback(() =>
  {
    if (finishedRef.current) return
    setPhase('done')
    void proceedAfterBrowser(1400)
  }, [proceedAfterBrowser])

  const fail = useCallback((detail: BrowserInstallError | undefined, status?: BrowserStatus) =>
  {
    setError(detail ?? FALLBACK_ERROR)
    if (status) setSystemBrowsers(status.systemBrowsers)
    setPhase('error')
  }, [])

  const runSetup = useCallback(async () =>
  {
    setError(null)
    setPhase('checking')
    let status: BrowserStatus
    try
    {
      status = await window.api.browser.getStatus()
    }
    catch (err)
    {
      fail({ ...FALLBACK_ERROR, message: err instanceof Error ? err.message : String(err) })
      return
    }
    setSystemBrowsers(status.systemBrowsers)
    if (status.installState) setInstall(status.installState)

    if (status.installed && status.verified)
    {
      await proceedAfterBrowser(0)
      return
    }

    try
    {
      if (status.installed)
      {
        setPhase('verifying')
        const result = await window.api.browser.verify()
        if (result.ok) succeed()
        else fail(result.error, result.status)
        return
      }
      setPhase('installing')
      const result = await window.api.browser.install()
      if (result.ok) succeed()
      else fail(result.error, result.status)
    }
    catch (err)
    {
      fail({ ...FALLBACK_ERROR, message: err instanceof Error ? err.message : String(err) })
    }
  }, [fail, proceedAfterBrowser, succeed])

  useEffect(() =>
  {
    const offProgress = window.api.browser.onInstallProgress(appendLog)
    const offState = window.api.browser.onInstallState(state =>
    {
      setInstall(state)
      if (state.stage === 'verifying')
      {
        setPhase(current => (current === 'checking' || current === 'installing' ? 'verifying' : current))
      }
      else if (state.stage === 'preparing' || state.stage === 'downloading' || state.stage === 'extracting' || state.stage === 'retrying')
      {
        setPhase(current => (current === 'checking' || current === 'verifying' ? 'installing' : current))
      }
    })
    void runSetup()

    // Safety net: if the request driving this screen is ever lost, a browser
    // that became ready in the background still moves setup along.
    const poll = setInterval(async () =>
    {
      if (finishedRef.current) return
      const status = await window.api.browser.getStatus().catch(() => null)
      if (status?.installed && status.verified && !status.installing) succeed()
    }, 5000)

    return () =>
    {
      offProgress()
      offState()
      clearInterval(poll)
    }
  }, [appendLog, runSetup, succeed])

  async function pickSystemBrowser(browser: SystemBrowser)
  {
    setBusy(true)
    try
    {
      const result = await window.api.browser.useExecutable(browser.path)
      if (result.ok) succeed()
      else fail(result.error, result.status)
    }
    catch (err)
    {
      fail({ ...FALLBACK_ERROR, message: err instanceof Error ? err.message : String(err) })
    }
    finally
    {
      setBusy(false)
    }
  }

  async function copyCommand()
  {
    if (!error?.command) return
    try
    {
      if (!(await copyText(error.command))) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    catch
    {
      // clipboard unavailable; the text stays selectable
    }
  }

  return { phase, install, error, systemBrowsers, log, busy, copied, logRef, runSetup, pickSystemBrowser, copyCommand }
}
