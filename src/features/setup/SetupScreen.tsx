import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertCircle, KeyRound, ExternalLink, ArrowRight, Copy, RotateCcw, Globe } from 'lucide-react'
import Button from '../../components/ui/Button'
import type { BrowserInstallError, BrowserInstallState, BrowserStatus, SystemBrowser } from '../../../electron/ipc/types'
import styles from './SetupScreen.module.css'

interface Props
{
  onComplete: () => void
}

type Phase = 'checking' | 'installing' | 'verifying' | 'done' | 'tmdb' | 'error'

const ERROR_TITLES: Record<BrowserInstallError['kind'], string> = {
  offline: 'No internet connection',
  network: 'Download interrupted',
  blocked: 'Download blocked',
  disk: 'Not enough disk space',
  permission: 'Folder not writable',
  antivirus: 'Files were blocked',
  'missing-deps': 'System libraries missing',
  launch: 'Chromium could not start',
  cancelled: 'Setup cancelled',
  unknown: 'Setup failed',
}

const STAGE_VERBS: Partial<Record<BrowserInstallState['stage'], string>> = {
  preparing: 'Preparing',
  downloading: 'Downloading',
  extracting: 'Extracting',
  verifying: 'Verifying',
  retrying: 'Retrying',
}

const FALLBACK_ERROR: BrowserInstallError = {
  kind: 'unknown',
  message: 'Setup failed',
  hint: 'Retry, or check the log for details.',
}

/**
 * Headline for the install block: the stage verb plus the item in flight.
 *
 * @param state - Latest install state from the main process.
 * @returns Text such as "Downloading Chromium Headless Shell 141".
 */
function describeStage(state: BrowserInstallState | null): string
{
  if (!state) return 'Starting…'
  const verb = STAGE_VERBS[state.stage] ?? 'Working'
  if (state.stage === 'retrying') return state.label || 'Retrying…'
  if (state.stage === 'downloading' && state.label && !state.label.endsWith('…')) return `${verb} ${state.label}`
  return state.label || `${verb}…`
}

/** First-run gate: verifies the bundled browser or installs one, with recovery paths when that fails. */
export default function SetupScreen({ onComplete }: Props)
{
  const [phase, setPhase] = useState<Phase>('checking')
  const [install, setInstall] = useState<BrowserInstallState | null>(null)
  const [error, setError] = useState<BrowserInstallError | null>(null)
  const [systemBrowsers, setSystemBrowsers] = useState<SystemBrowser[]>([])
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tmdbKey, setTmdbKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
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
      await navigator.clipboard.writeText(error.command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    catch
    {
      // clipboard unavailable; the text stays selectable
    }
  }

  // Saves the pasted key (if any) and dismisses onboarding. Skipping passes an
  // empty key through - matching simply falls back to title and year.
  async function finishTmdbStep(save: boolean)
  {
    const key = tmdbKey.trim()
    if (save && key)
    {
      setSavingKey(true)
      try
      {
        await window.api.config.set({ tmdbApiKey: key })
      }
      finally
      {
        setSavingKey(false)
      }
    }
    onComplete()
  }

  const percent = install?.percent ?? null
  const showAttempts = (install?.attempt ?? 0) > 1 || install?.stage === 'retrying'

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className={styles.card}>
        {/* App identity */}
        <div className={styles.brand}>
          <div className={styles.logoRing}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="12" fill="rgba(229,160,13,0.15)" stroke="#e5a00d" strokeWidth="1.5" />
              <polygon points="11,9 21,14 11,19" fill="#e5a00d" />
            </svg>
          </div>
          <div>
            <div className={styles.appName}>Plex Poster Helper</div>
            <div className={styles.appSub}>First-run setup</div>
          </div>
        </div>

        {/* Status */}
        <AnimatePresence mode="wait">
          {phase === 'checking' && (
            <motion.div key="checking" className={styles.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className={styles.spinner} />
              <span>Checking environment…</span>
            </motion.div>
          )}

          {phase === 'verifying' && (
            <motion.div key="verifying" className={styles.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className={styles.spinner} />
              <span>Making sure Chromium starts…</span>
            </motion.div>
          )}

          {phase === 'installing' && (
            <motion.div key="installing" className={styles.installBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className={styles.phaseRow}>
                <div className={styles.spinner} />
                <span className={styles.phaseLabel}>{describeStage(install)}</span>
              </div>

              {/* Progress bar: determinate while a file downloads, otherwise a sweeping indicator */}
              <div className={styles.progressTrack}>
                {percent === null ? (
                  <div className={`${styles.progressFill} ${styles.progressIndeterminate}`} />
                ) : (
                  <motion.div
                    className={styles.progressFill}
                    animate={{ width: `${percent}%` }}
                    transition={{ ease: 'easeOut', duration: 0.3 }}
                  />
                )}
              </div>
              <div className={styles.attemptRow}>
                <span>{showAttempts && install ? `Attempt ${install.attempt} of ${install.maxAttempts}` : ''}</span>
                <span>{percent === null ? '' : `${percent}%`}</span>
              </div>

              {install?.stage === 'retrying' && install.error && (
                <div className={styles.retryNote}>
                  {install.error.message}. {install.error.hint}
                </div>
              )}

              {/* Live log */}
              <div className={styles.logBox} ref={logRef}>
                {log.map((line, i) => (
                  <div key={i} className={styles.logLine}>{line}</div>
                ))}
              </div>
            </motion.div>
          )}

          {phase === 'done' && (
            <motion.div key="done" className={styles.doneBlock} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <CheckCircle2 size={32} className={styles.doneIcon} />
              <span className={styles.doneLabel}>Browser ready</span>
            </motion.div>
          )}

          {phase === 'tmdb' && (
            <motion.div key="tmdb" className={styles.tmdbBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className={styles.tmdbHead}>
                <KeyRound size={16} className={styles.tmdbIcon} />
                <span className={styles.tmdbTitle}>Add a TMDB API key (optional)</span>
              </div>
              <p className={styles.tmdbDesc}>
                Recommended: a free TMDB key lets the app match your library by ID instead of guessing
                by title and year, which fixes most matching and title-mapping issues. You can always
                add or change it later in Settings.
              </p>
              <input
                className={styles.tmdbInput}
                type="password"
                value={tmdbKey}
                onChange={e => setTmdbKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void finishTmdbStep(true) }}
                placeholder="Paste TMDB v3 API key…"
                spellCheck={false}
                autoFocus
              />
              <button
                className={styles.tmdbLink}
                onClick={() => window.api.app.openExternal('https://www.themoviedb.org/settings/api')}
              >
                <ExternalLink size={12} /> Get a free key at themoviedb.org
              </button>
              <div className={styles.tmdbActions}>
                <Button variant="ghost" size="sm" onClick={() => void finishTmdbStep(false)} disabled={savingKey}>
                  Skip for now
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<ArrowRight size={13} />}
                  onClick={() => void finishTmdbStep(true)}
                  loading={savingKey}
                  disabled={savingKey}
                >
                  {tmdbKey.trim() ? 'Save & continue' : 'Continue'}
                </Button>
              </div>
            </motion.div>
          )}

          {phase === 'error' && error && (
            <motion.div key="error" className={styles.errorBlock} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AlertCircle size={24} className={styles.errorIcon} />
              <span className={styles.errorTitle}>{ERROR_TITLES[error.kind] ?? 'Setup failed'}</span>
              <span className={styles.errorMsg}>{error.message}</span>
              <span className={styles.errorHint}>{error.hint}</span>

              {error.command && (
                <div className={styles.commandBox}>
                  <code className={styles.commandText}>{error.command}</code>
                  <button className={styles.commandCopy} onClick={() => void copyCommand()} title="Copy command" aria-label="Copy command">
                    {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              )}

              {systemBrowsers.length > 0 && error.kind !== 'cancelled' && (
                <div className={styles.altRow}>
                  <span className={styles.altLabel}>Or use a browser already on this machine:</span>
                  {systemBrowsers.map(browser => (
                    <Button
                      key={browser.path}
                      variant="ghost"
                      size="sm"
                      icon={<Globe size={13} />}
                      onClick={() => void pickSystemBrowser(browser)}
                      disabled={busy}
                      title={browser.path}
                    >
                      {browser.name}
                    </Button>
                  ))}
                </div>
              )}

              <div className={styles.logBox} ref={logRef}>
                {log.slice(-20).map((line, i) => (
                  <div key={i} className={styles.logLine}>{line}</div>
                ))}
              </div>

              <div className={styles.errorActions}>
                <Button variant="primary" size="sm" icon={<RotateCcw size={13} />} onClick={() => void runSetup()} disabled={busy}>
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={onComplete} disabled={busy}>
                  Continue without a browser
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
