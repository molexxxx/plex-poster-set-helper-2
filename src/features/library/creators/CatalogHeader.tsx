import { CalendarClock, ExternalLink, Eye, EyeOff, History, Loader2, RefreshCw, Star, User, UserPlus } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Menu from '../../../components/ui/Menu'
import type { ScheduledJob } from '../../../../electron/ipc/types'
import { describeCron } from '../../../../electron/services/scheduleUtils'
import type { CreatorState } from '../../../utils/creatorPrefs'
import { creatorUrl, timeAgo } from '../libraryShared'
import type { SyncScope } from './CreatorSyncDialog'
import type { CreatorCatalogData } from './hooks/useCreatorCatalog'
import { count, plural } from './catalogUtils'
import shared from './catalogShared.module.css'
import styles from './CatalogHeader.module.css'

interface CatalogHeaderProps
{
  username: string
  creator: CreatorState
  catalog: CreatorCatalogData
  /** Id for the heading that names the catalog. */
  titleId: string
  avatar?: string
  totalSets: number
  totalInLibrary: number
  crawling: boolean
  /** The job that syncs this creator, when one does. */
  creatorJob?: ScheduledJob
  onCreatorChange: (state: CreatorState) => void
  setSyncScope: (scope: SyncScope) => void
  setConfirmReread: (open: boolean) => void
}

/** The catalog header: the creator's avatar and name, catalog and sync status, Follow, sync setup, and more actions. */
export default function CatalogHeader({
  username, creator, catalog, titleId, avatar, totalSets, totalInLibrary, crawling, creatorJob, onCreatorChange, setSyncScope, setConfirmReread,
}: CatalogHeaderProps)
{
  const following = creator === 'followed'

  const statusLine = !catalog.ready
    ? 'Reading their catalog from MediUX…'
    : catalog.error && !totalSets
      ? 'Could not read their catalog'
      : `${plural(totalSets, 'set')} · ${count(totalInLibrary)} in your library${crawling ? ' · still reading the catalog' : catalog.capped ? ` · the newest ${count(totalSets)} (MediUX's browse limit)` : ''}`
  const syncLine = creatorJob
    ? `Synced ${describeCron(creatorJob.cronExpr).toLowerCase()}${creatorJob.since ? `, new uploads since ${new Date(creatorJob.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}${creatorJob.enabled ? '' : ' (paused)'}`
    : 'Not synced'

  const menuItems = [
    { label: catalog.checking ? 'Checking for new sets…' : 'Check for new sets', icon: <RefreshCw size={14} />, disabled: catalog.checking || catalog.rereading || crawling, onSelect: catalog.check },
    { label: 'Re-read the whole catalog…', icon: <History size={14} />, disabled: catalog.rereading || crawling, onSelect: () => setConfirmReread(true) },
    { label: 'Open on MediUX', icon: <ExternalLink size={14} />, onSelect: () => window.api.app.openExternal(creatorUrl('mediux', username)) },
    creator === 'hidden'
      ? { label: 'Unhide creator', icon: <Eye size={14} />, onSelect: () => onCreatorChange('none') }
      : { label: 'Hide creator', icon: <EyeOff size={14} />, onSelect: () => onCreatorChange('hidden') },
  ]

  return (
    <header className={styles.head}>
      <div className={styles.identity}>
        {avatar ? <img className={styles.avatar} src={avatar} alt="" /> : <span className={styles.avatarFallback} aria-hidden><User size={18} /></span>}
        <div className={styles.identityText}>
          <h2 id={titleId} className={styles.name}>@{username}</h2>
          <p className={styles.status}>{statusLine}</p>
          <p className={styles.meta}>
            <span>{syncLine}</span>
            <span aria-hidden>·</span>
            {catalog.rereading
              ? <span className={styles.working}><Loader2 size={12} className={shared.spin} aria-hidden /> Re-reading the whole catalog; these sets stay in use until it finishes</span>
              : catalog.checking
                ? <span className={styles.working}><Loader2 size={12} className={shared.spin} aria-hidden /> Checking for new sets</span>
                : catalog.fetchedAt
                  ? <span>Checked {timeAgo(catalog.fetchedAt)} <button type="button" className={shared.inlineAction} onClick={catalog.check} disabled={crawling}>Check now</button></span>
                  : <span>{crawling ? 'First read in progress' : 'Not checked yet'}</span>}
          </p>
        </div>
      </div>
      <div className={styles.headActions}>
        <Button
          variant={following ? 'secondary' : 'primary'}
          size="sm"
          icon={following ? <Star size={12} fill="currentColor" /> : <UserPlus size={12} />}
          aria-pressed={following}
          onClick={() => onCreatorChange(following ? 'none' : 'followed')}
          title={following ? `Unfollow @${username}` : `Follow @${username}`}
        >
          {following ? 'Following' : 'Follow'}
        </Button>
        <Button
          variant={creatorJob ? 'secondary' : 'primary'}
          size="sm"
          icon={<CalendarClock size={12} />}
          onClick={() => setSyncScope({ kind: 'creator' })}
          disabled={!catalog.ready || (!totalSets && !!catalog.error)}
        >
          {creatorJob ? 'Sync settings…' : 'Set up sync…'}
        </Button>
        <Menu label={`More actions for @${username}`} items={menuItems} />
      </div>
    </header>
  )
}
