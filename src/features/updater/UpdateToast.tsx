import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, X, Loader2, Sparkles, Container, BookOpen } from 'lucide-react'
import { useUpdater } from './UpdaterContext'
import styles from './UpdateToast.module.css'

/**
 * Formats a byte count as megabytes.
 *
 * @param bytes - Raw byte count.
 * @returns A string like "12.3 MB".
 */
function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

const DOCKER_GUIDE = 'https://github.com/tonywied17/plex-poster-set-helper-2/blob/main/docker/README.md#updating-to-a-new-version'

/** Corner toast announcing updates with download/restart actions. */
export default function UpdateToast() {
  const { status, info, progress, mode, dismissed, download, restart, dismiss } = useUpdater()
  const isDocker = mode === 'docker'

  const visible =
    (status === 'available' && !dismissed) ||
    (!isDocker && (status === 'downloading' || status === 'ready'))

  const shell = (icon: React.ReactNode, title: string, desc: React.ReactNode, actions: React.ReactNode, showClose = true) => (
    <motion.div
      className={styles.toast}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={styles.head}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.title}>{title}</span>
        {showClose && <button className={styles.close} onClick={dismiss} title="Dismiss"><X size={14} /></button>}
      </div>
      {desc && <div className={styles.desc}>{desc}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </motion.div>
  )

  // Docker can't self-update; link to the pull-and-recreate guide instead
  if (isDocker) {
    return (
      <AnimatePresence>
        {status === 'available' && !dismissed && shell(
          <Container size={15} />,
          `New version ${info?.version ? `v${info.version} ` : ''}available`,
          <>You're running in Docker — pull the new image and recreate the container to update.</>,
          <button className={styles.primary} onClick={() => window.api.app.openExternal(info?.releaseUrl || DOCKER_GUIDE)}>
            <BookOpen size={13} /> How to update
          </button>,
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        status === 'downloading'
          ? shell(
              <Loader2 size={15} className={styles.spin} />,
              'Downloading update…',
              <>
                <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${progress?.percent ?? 0}%` }} /></div>
                <span className={styles.metaLine}>{progress ? `${Math.round(progress.percent)}% · ${fmtMB(progress.transferred)} / ${fmtMB(progress.total)} MB` : 'Starting…'}</span>
              </>,
              null,
              false,
            )
          : status === 'ready'
            ? shell(
                <RefreshCw size={15} />,
                'Update ready to install',
                <>The app will install silently and relaunch.</>,
                <button className={styles.primary} onClick={restart}><RefreshCw size={13} /> Relaunch</button>,
              )
            : shell(
                <Sparkles size={15} />,
                `Update available${info?.version ? ` — v${info.version}` : ''}`,
                <>A new version is ready to download.</>,
                <>
                  <button className={styles.primary} onClick={download}><Download size={13} /> Download</button>
                  <button className={styles.ghost} onClick={dismiss}>Later</button>
                </>,
              )
      )}
    </AnimatePresence>
  )
}
