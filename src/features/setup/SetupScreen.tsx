import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { useBrowserSetup } from './hooks/useBrowserSetup'
import InstallProgress from './components/InstallProgress'
import TmdbStep from './components/TmdbStep'
import SetupError from './components/SetupError'
import shared from './components/setupShared.module.css'
import styles from './SetupScreen.module.css'

interface Props
{
  onComplete: () => void
}

/** First-run gate: verifies the bundled browser or installs one, with recovery paths when that fails. */
export default function SetupScreen({ onComplete }: Props)
{
  const { phase, install, error, systemBrowsers, log, busy, copied, logRef, runSetup, pickSystemBrowser, copyCommand } = useBrowserSetup(onComplete)

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
              <div className={shared.spinner} />
              <span>Checking environment…</span>
            </motion.div>
          )}

          {phase === 'verifying' && (
            <motion.div key="verifying" className={styles.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className={shared.spinner} />
              <span>Making sure Chromium starts…</span>
            </motion.div>
          )}

          {phase === 'installing' && (
            <InstallProgress key="installing" install={install} log={log} logRef={logRef} />
          )}

          {phase === 'done' && (
            <motion.div key="done" className={styles.doneBlock} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <CheckCircle2 size={32} className={styles.doneIcon} />
              <span className={styles.doneLabel}>Browser ready</span>
            </motion.div>
          )}

          {phase === 'tmdb' && (
            <TmdbStep key="tmdb" onComplete={onComplete} />
          )}

          {phase === 'error' && error && (
            <SetupError
              key="error"
              error={error}
              systemBrowsers={systemBrowsers}
              log={log}
              logRef={logRef}
              busy={busy}
              copied={copied}
              onCopyCommand={() => void copyCommand()}
              onPickBrowser={browser => void pickSystemBrowser(browser)}
              onRetry={() => void runSetup()}
              onSkip={onComplete}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
