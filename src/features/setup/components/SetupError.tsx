import type { RefObject } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Copy, RotateCcw, Globe } from 'lucide-react'
import Button from '../../../components/ui/Button'
import type { BrowserInstallError, SystemBrowser } from '../../../../electron/ipc/types'
import { ERROR_TITLES } from '../setupText'
import SetupLog from './SetupLog'
import styles from './SetupError.module.css'

interface SetupErrorProps
{
  error: BrowserInstallError
  systemBrowsers: SystemBrowser[]
  log: string[]
  logRef: RefObject<HTMLDivElement | null>
  /** An action is running, so the buttons wait. */
  busy: boolean
  copied: boolean
  onCopyCommand: () => void
  onPickBrowser: (browser: SystemBrowser) => void
  onRetry: () => void
  onSkip: () => void
}

/** Why setup failed, with the fix to run, browsers already on the machine, the log, and Retry. */
export default function SetupError({
  error, systemBrowsers, log, logRef, busy, copied, onCopyCommand, onPickBrowser, onRetry, onSkip,
}: SetupErrorProps)
{
  return (
    <motion.div className={styles.errorBlock} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <AlertCircle size={24} className={styles.errorIcon} />
      <span className={styles.errorTitle}>{ERROR_TITLES[error.kind] ?? 'Setup failed'}</span>
      <span className={styles.errorMsg}>{error.message}</span>
      <span className={styles.errorHint}>{error.hint}</span>

      {error.command && (
        <div className={styles.commandBox}>
          <code className={styles.commandText}>{error.command}</code>
          <button className={styles.commandCopy} onClick={onCopyCommand} title="Copy command" aria-label="Copy command">
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
              onClick={() => onPickBrowser(browser)}
              disabled={busy}
              title={browser.path}
            >
              {browser.name}
            </Button>
          ))}
        </div>
      )}

      <SetupLog lines={log.slice(-20)} ref={logRef} />

      <div className={styles.errorActions}>
        <Button variant="primary" size="sm" icon={<RotateCcw size={13} />} onClick={onRetry} disabled={busy}>
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy}>
          Continue without a browser
        </Button>
      </div>
    </motion.div>
  )
}
