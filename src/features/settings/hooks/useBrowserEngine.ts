import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserActionResult, BrowserInstallError, BrowserStatus } from '../../../../electron/ipc/types'
import { copyText } from '../../../utils/clipboard'

/**
 * The headless browser the scrapers use: its status, installing or switching
 * it, and the install log. Reads the status on mount.
 *
 * @param announce - Reads a result out to screen readers.
 * @returns The status, the install state and log, whether the details are open, and the actions.
 */
export function useBrowserEngine(announce: (message: string) => void)
{
  const [browserStatus, setBrowserStatus]         = useState<BrowserStatus | null>(null)
  const [browserInstalling, setBrowserInstalling] = useState(false)
  const [installLog, setInstallLog]               = useState<string[]>([])
  const [copiedPath, setCopiedPath]               = useState(false)
  const [engineOpen, setEngineOpen]               = useState(false)
  const installLogRef = useRef<HTMLDivElement>(null)

  const loadBrowserStatus = useCallback(async () =>
  {
    const s = await window.api.browser.getStatus() as BrowserStatus
    setBrowserStatus(s)
    if (!s.installed) setEngineOpen(true)
  }, [])

  useEffect(() =>
  {
    loadBrowserStatus()
  }, [loadBrowserStatus])

  async function copyPath()
  {
    if (!browserStatus?.executablePath) return
    try
    {
      if (!(await copyText(browserStatus.executablePath))) return
      setCopiedPath(true)
      announce('Path copied')
      setTimeout(() => setCopiedPath(false), 1800)
    }
    catch { /* clipboard may be blocked */ }
  }

  function appendInstallLog(line: string)
  {
    setInstallLog(prev => [...prev, line])
    setTimeout(() =>
    {
      installLogRef.current?.scrollTo({ top: installLogRef.current.scrollHeight })
    }, 30)
  }

  function reportBrowserError(error: BrowserInstallError | undefined)
  {
    if (!error) return
    appendInstallLog(`✗ ${error.message}. ${error.hint}`)
    if (error.command) appendInstallLog(`  ${error.command}`)
  }

  async function runBrowserAction(action: () => Promise<BrowserActionResult>)
  {
    setBrowserInstalling(true)
    setInstallLog([])
    const off = window.api.browser.onInstallProgress(appendInstallLog)
    try
    {
      const result = await action()
      if (result.ok)
      {
        appendInstallLog('✓ Browser ready')
        announce('Browser engine ready')
      }
      else
      {
        reportBrowserError(result.error)
      }
      setBrowserStatus(result.status)
    }
    catch (err)
    {
      appendInstallLog(`✗ ${err instanceof Error ? err.message : String(err)}`)
      await loadBrowserStatus()
    }
    finally
    {
      off()
      setBrowserInstalling(false)
    }
  }

  function installBrowser()
  {
    setEngineOpen(true)
    void runBrowserAction(() => window.api.browser.install({ force: browserStatus?.source === 'managed' }))
  }

  async function cancelBrowserInstall()
  {
    setBrowserStatus(await window.api.browser.cancelInstall())
  }

  return {
    browserStatus, browserInstalling, installLog, installLogRef, copiedPath, engineOpen, setEngineOpen,
    copyPath, runBrowserAction, installBrowser, cancelBrowserInstall,
  }
}

/** The browser engine state and actions `useBrowserEngine` returns. */
export type BrowserEngine = ReturnType<typeof useBrowserEngine>
