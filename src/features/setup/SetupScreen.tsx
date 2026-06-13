import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertCircle, KeyRound, ExternalLink, ArrowRight } from 'lucide-react'
import Button from '../../components/ui/Button'
import styles from './SetupScreen.module.css'

interface Props {
  onComplete: () => void
}

type Phase = 'checking' | 'installing' | 'done' | 'tmdb' | 'error'

/**
 * Extracts the percentage from a progress line like "| 72% of 123.4 MiB".
 *
 * @param line - One line of installer output.
 * @returns The percent value, or null when the line has none.
 */
function parsePercent(line: string): number | null {
  const m = line.match(/\|\s*(\d+)%/)
  return m ? parseInt(m[1]) : null
}

/**
 * Extracts the phase label from a line like "Downloading Chromium 132...".
 *
 * @param line - One line of installer output.
 * @returns The label (e.g. "Chromium 132..."), or null.
 */
function parsePhaseLabel(line: string): string | null {
  const m = line.match(/^Downloading\s+(.+?)\s+from\s+/i)
  return m ? m[1] : null
}

/** First-run screen that auto-installs Chromium and shows install progress. */
export default function SetupScreen({ onComplete }: Props) {
  const [phase,      setPhase]      = useState<Phase>('checking')
  const [progress,   setProgress]   = useState(0)
  const [phaseLabel, setPhaseLabel] = useState('Preparing…')
  const [log,        setLog]        = useState<string[]>([])
  const [error,      setError]      = useState<string | null>(null)
  const [tmdbKey,    setTmdbKey]    = useState('')
  const [savingKey,  setSavingKey]  = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  function appendLog(line: string) {
    setLog(prev => [...prev.slice(-120), line])   // keep last 120 lines
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }

  useEffect(() => {
    let progressOff: (() => void) | null = null

    // After the browser is ready, offer the optional TMDB key step, but only when
    // a key isn't already configured (returning users skip straight through).
    async function proceedAfterBrowser(delayMs: number) {
      const cfg = await window.api.config.get()
      const hasKey = (cfg.tmdbApiKey ?? '').trim().length > 0
      setTimeout(() => (hasKey ? onComplete() : setPhase('tmdb')), delayMs)
    }

    async function run() {
      // Subscribe before the status check so no early output is missed
      progressOff = window.api.browser.onInstallProgress((line: string) => {
        appendLog(line)
        const pct = parsePercent(line)
        if (pct !== null) setProgress(pct)
        const label = parsePhaseLabel(line)
        if (label) { setPhaseLabel(label); setProgress(0) }
      })

      const status = await window.api.browser.getStatus()
      if (status.installed) {
        await proceedAfterBrowser(0)
        return
      }

      setPhase('installing')
      setPhaseLabel('Starting download…')

      try {
        await window.api.browser.install()
        setProgress(100)
        setPhase('done')
        setPhaseLabel('Chromium ready')
        // Short pause so the user sees the success state, then move on
        await proceedAfterBrowser(1400)
      } catch (err) {
        setPhase('error')
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void run()
    return () => { progressOff?.() }
  }, [onComplete])

  // Saves the pasted key (if any) and dismisses onboarding. Skipping passes an
  // empty key through - matching simply falls back to title and year.
  async function finishTmdbStep(save: boolean) {
    const key = tmdbKey.trim()
    if (save && key) {
      setSavingKey(true)
      try { await window.api.config.set({ tmdbApiKey: key }) } finally { setSavingKey(false) }
    }
    onComplete()
  }

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

          {phase === 'installing' && (
            <motion.div key="installing" className={styles.installBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className={styles.phaseRow}>
                <div className={styles.spinner} />
                <span className={styles.phaseLabel}>Downloading {phaseLabel}</span>
              </div>

              {/* Progress bar */}
              <div className={styles.progressTrack}>
                <motion.div
                  className={styles.progressFill}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                />
              </div>
              <div className={styles.progressPct}>{progress}%</div>

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

          {phase === 'error' && (
            <motion.div key="error" className={styles.errorBlock} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AlertCircle size={24} className={styles.errorIcon} />
              <span className={styles.errorTitle}>Setup failed</span>
              <span className={styles.errorMsg}>{error}</span>
              <div className={styles.logBox} ref={logRef} style={{ marginTop: 12 }}>
                {log.slice(-20).map((line, i) => (
                  <div key={i} className={styles.logLine}>{line}</div>
                ))}
              </div>
              <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
              <Button variant="ghost" size="sm" onClick={onComplete}>
                Skip (scraping won't work)
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
