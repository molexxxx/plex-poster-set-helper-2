import { useId } from 'react'
import { Plus, LibraryBig, Users } from 'lucide-react'
import Button from '../../../components/ui/Button'
import shared from '../schedulerShared.module.css'
import styles from './EmptyJobs.module.css'
/** First-run panel: what a job does, and the three ways to make one. */
export default function EmptyJobs({ onNew, onOpenCreators, onOpenLibrary }: { onNew: () => void; onOpenCreators: () => void; onOpenLibrary: () => void }) {
  const titleId = useId()
  return (
    <section className={shared.block} aria-labelledby={titleId}>
      <div className={shared.blockHead}>
        <h2 id={titleId} className={shared.blockTitle}>No scheduled jobs yet</h2>
      </div>
      <p className={styles.emptyIntro}>
        A job checks MediUX creators and sets, or ThePosterDB sets, on a schedule and applies their new art to Plex by itself.
      </p>
      <div className={shared.panel}>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Keep up with a creator</span>
            <span className={shared.detailRowValue}>Follow a MediUX creator in the Library Browser&apos;s Creators tab and use Sync. Their new uploads apply as they appear.</span>
          </div>
          <Button variant="secondary" size="sm" icon={<Users size={13} />} onClick={onOpenCreators}>Open Creators</Button>
        </div>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Keep one set current</span>
            <span className={shared.detailRowValue}>Open a title in the Library Browser and use Schedule on one of its sets.</span>
          </div>
          <Button variant="secondary" size="sm" icon={<LibraryBig size={13} />} onClick={onOpenLibrary}>Open the Library Browser</Button>
        </div>
        <div className={shared.detailRow}>
          <div className={shared.detailRowText}>
            <span className={shared.detailRowLabel}>Start from links</span>
            <span className={shared.detailRowValue}>Paste MediUX or ThePosterDB links and pick when the job runs.</span>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={onNew}>New job</Button>
        </div>
      </div>
    </section>
  )
}
