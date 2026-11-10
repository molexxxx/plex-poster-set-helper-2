import { Settings } from 'lucide-react'
import Button from '../../components/ui/Button'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import LogViewer from './LogViewer'
import styles from './LogsPage.module.css'

/** The full-height Logs page: every kept day, with search, filters, and file actions. */
export default function LogsPage()
{
  const { navigate } = useAppContext()

  function openSettings()
  {
    useNavStore.getState().goSettings('logs')
    navigate('settings')
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className="page-title">Logs</h1>
          <p className="page-subtitle">
            What the app has done, saved one file per day. Pick a day to read further back, or copy diagnostics for a bug report.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={<Settings size={13} />} onClick={openSettings}>
          How long logs are kept
        </Button>
      </div>
      <div className={styles.viewer}>
        <LogViewer mode="page" />
      </div>
    </div>
  )
}
