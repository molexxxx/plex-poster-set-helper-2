import { useEffect } from 'react'
import { ScrollText } from 'lucide-react'
import LogViewer from './LogViewer'
import styles from './LogWindow.module.css'

/**
 * The pop-out log window: a separate desktop window, or a browser tab in the
 * web UI. Its title strip is the window's drag area beside the system controls.
 */
export default function LogWindow()
{
  useEffect(() =>
  {
    document.title = 'Logs - Plex Poster Set Helper 2'
  }, [])

  return (
    <div className={styles.window}>
      <header className={styles.titleBar}>
        <ScrollText size={14} aria-hidden />
        <h1 className={styles.title}>Logs</h1>
        <span className={styles.app}>Plex Poster Set Helper 2</span>
      </header>
      <main className={styles.body}>
        <LogViewer mode="window" />
      </main>
    </div>
  )
}
