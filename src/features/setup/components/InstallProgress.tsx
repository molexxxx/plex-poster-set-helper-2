import type { RefObject } from 'react'
import { motion } from 'framer-motion'
import type { BrowserInstallState } from '../../../../electron/ipc/types'
import { describeStage } from '../setupText'
import SetupLog from './SetupLog'
import shared from './setupShared.module.css'
import styles from './InstallProgress.module.css'

interface InstallProgressProps
{
  install: BrowserInstallState | null
  log: string[]
  logRef: RefObject<HTMLDivElement | null>
}

/** The browser download in progress: its stage, a progress bar, retry attempts, and the live log. */
export default function InstallProgress({ install, log, logRef }: InstallProgressProps)
{
  const percent = install?.percent ?? null
  const showAttempts = (install?.attempt ?? 0) > 1 || install?.stage === 'retrying'

  return (
    <motion.div className={styles.installBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className={styles.phaseRow}>
        <div className={shared.spinner} />
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
      <SetupLog lines={log} ref={logRef} />
    </motion.div>
  )
}
