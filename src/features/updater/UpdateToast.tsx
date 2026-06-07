import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, X, Loader2, Sparkles, Container, BookOpen } from 'lucide-react'
import { useUpdater } from './UpdaterContext'
import styles from './UpdateToast.module.css'

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

const DOCKER_GUIDE = 'https://github.com/tonywied17/plex-poster-set-helper/blob/main/docker/README.md#updating-to-a-new-version'

export default function UpdateToast() {
  const { status, info, progress, mode, dismissed, download, restart, dismiss } = useUpdater()

  const isDocker = mode === 'docker'

  // The toast shows for available (until dismissed) and always for download/ready.
  const visible =
    (status === 'available' && !dismissed) ||
    (!isDocker && (status === 'downloading' || status === 'ready'))

  // Docker can't self-update — show "pull a new image" guidance instead of Download.
  if (isDocker) {
    return (
      <AnimatePresence>
        {status === 'available' && !dismissed && (
          <motion.div
            className={styles.toast}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.icon}><Container size={16} /></div>
            <div className={styles.body}>
              <span className={styles.title}>New version{info?.version ? ` v${info.version}` : ''} available</span>
              <span className={styles.sub}>You're running in Docker — pull the new image and recreate the container to update.</span>
            </div>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => window.api.app.openExternal(info?.releaseUrl || DOCKER_GUIDE)}>
                <BookOpen size={13} /> How to update
              </button>
              <button className={styles.close} onClick={dismiss} title="Dismiss"><X size={14} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.toast}
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.icon}>
            {status === 'downloading' ? <Loader2 size={16} className={styles.spin} />
              : status === 'ready' ? <RefreshCw size={16} />
              : <Sparkles size={16} />}
          </div>

          <div className={styles.body}>
            {status === 'available' && (
              <>
                <span className={styles.title}>Update available{info?.version ? ` - v${info.version}` : ''}</span>
                <span className={styles.sub}>A new version is ready to download.</span>
              </>
            )}
            {status === 'downloading' && (
              <>
                <span className={styles.title}>Downloading update…</span>
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <span className={styles.sub}>
                  {progress
                    ? `${Math.round(progress.percent)}% · ${fmtMB(progress.transferred)} / ${fmtMB(progress.total)} MB`
                    : 'Starting…'}
                </span>
              </>
            )}
            {status === 'ready' && (
              <>
                <span className={styles.title}>Update ready</span>
                <span className={styles.sub}>Restart to finish installing.</span>
              </>
            )}
          </div>

          <div className={styles.actions}>
            {status === 'available' && (
              <>
                <button className={styles.primary} onClick={download}><Download size={13} /> Download</button>
                <button className={styles.ghost} onClick={dismiss}>Later</button>
              </>
            )}
            {status === 'ready' && (
              <button className={styles.primary} onClick={restart}><RefreshCw size={13} /> Restart</button>
            )}
            {status !== 'downloading' && (
              <button className={styles.close} onClick={dismiss} title="Dismiss"><X size={14} /></button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
