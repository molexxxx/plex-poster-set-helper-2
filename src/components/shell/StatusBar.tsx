import { Settings, Download, RefreshCw, Loader2, Sparkles } from 'lucide-react'
import { useAppContext } from '../../app/AppContext'
import { useUpdater } from '../../features/updater/UpdaterContext'
import styles from './StatusBar.module.css'

export default function StatusBar() {
  const { plexConnected, navigate } = useAppContext()
  const { status, info, progress, version, reopen, restart } = useUpdater()

  const dotClass = styles[plexConnected ? 'dotOn' : 'dotOff']
  const label    = plexConnected ? 'Connected to Plex' : 'Not connected to Plex'

  const updateBadge = (() => {
    if (status === 'available')   return { icon: <Sparkles size={10} />, text: `Update available${info?.version ? ` v${info.version}` : ''}`, onClick: reopen, showDl: true }
    if (status === 'downloading') return { icon: <Loader2 size={10} className={styles.spin} />, text: `Downloading ${Math.round(progress?.percent ?? 0)}%`, onClick: reopen, showDl: false }
    if (status === 'ready')       return { icon: <RefreshCw size={10} />, text: 'Restart to update', onClick: restart, showDl: false }
    return null
  })()

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        {plexConnected ? (
          <>
            <span className={`${styles.dot} ${dotClass}`} />
            <span className={styles.text}>{label}</span>
          </>
        ) : (
          <button className={styles.connectBtn} onClick={() => navigate('settings')}>
            <span className={`${styles.dot} ${dotClass}`} />
            <span className={styles.text}>{label}</span>
            <Settings size={10} className={styles.settingsIcon} />
          </button>
        )}
      </div>
      <div className={styles.right}>
        {updateBadge && (
          <button className={styles.updateBadge} onClick={updateBadge.onClick}>
            {updateBadge.icon}
            <span>{updateBadge.text}</span>
            {updateBadge.showDl && <Download size={10} />}
          </button>
        )}
        {version && <span className={styles.text}>v{version}</span>}
      </div>
    </div>
  )
}
