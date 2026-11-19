import { AnimatePresence } from 'framer-motion'
import { FileText } from 'lucide-react'
import EmptyState from '../../components/ui/EmptyState'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import { urlLines } from './bulkText'
import { useBulkFiles } from './hooks/useBulkFiles'
import FileSidebar from './components/FileSidebar'
import BulkEditor from './components/BulkEditor'
import RunResults from './components/RunResults'
import styles from './BulkPage.module.css'


/** Bulk import page: manage plain-text URL lists and run them against Plex. */
export default function BulkPage() {
  const { plexConnected } = useAppContext()
  const bulk = useBulkFiles()
  const urlCount = urlLines(bulk.content).length

  return (
    <div className={styles.page}>

      {/* Left: file list */}
      <FileSidebar bulk={bulk} />

      {/* Right: editor */}
      <div className={styles.editor}>
        {!plexConnected && <PlexConnectBanner />}
        {!bulk.active ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No file selected"
            description="Create or select a bulk file to edit its URL list."
          />
        ) : (
          <>
            <BulkEditor bulk={bulk} active={bulk.active} urlCount={urlCount} />

            {/* run results */}
            <AnimatePresence>
              {bulk.results.length > 0 && (
                <RunResults results={bulk.results} running={bulk.runStatus === 'running'} urlCount={urlCount} />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}
