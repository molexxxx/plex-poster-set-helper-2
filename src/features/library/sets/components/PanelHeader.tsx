import { AnimatePresence, motion } from 'framer-motion'
import { Link2, RefreshCw, X } from 'lucide-react'
import type { LibraryItem } from '../../../../../electron/ipc/types'
import type { BrowseSets } from '../hooks/useBrowseSets'
import type { LinkedSets } from '../hooks/useLinkedSets'
import shared from '../../libraryShared.module.css'
import styles from './PanelHeader.module.css'

interface PanelHeaderProps
{
  item: LibraryItem
  isCollectionItem: boolean
  browse: BrowseSets
  links: LinkedSets
  onClose: () => void
}

/** The panel header: the item's title, which crossfades between items, and the link, refresh, and close buttons. */
export default function PanelHeader({ item, isCollectionItem, browse, links, onClose }: PanelHeaderProps)
{
  const { loading, refreshing, refreshSets } = browse
  const { linkOpen, updateLinkUi } = links
  return (
    <div className={styles.panelHeader}>
      {/* Keyed on item.key: the panel chrome (position, resize handle,
          width) stays mounted across item switches, only this title
          crossfades. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={item.key}
          className={styles.panelTitleWrap}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <h2 className={styles.panelTitle}>{item.title}</h2>
          {isCollectionItem && item.childCount != null && (
            <span className={styles.panelYear}>{item.childCount} movie{item.childCount !== 1 ? 's' : ''}</span>
          )}
          {!isCollectionItem && item.year && <span className={styles.panelYear}>{item.year}</span>}
        </motion.div>
      </AnimatePresence>
      <div className={styles.panelHeaderActions}>
        <button
          className={`${styles.panelRefresh} ${linkOpen ? styles.panelActionOn : ''}`}
          onClick={() => updateLinkUi({ open: !linkOpen, error: null })}
          title="Link a set from MediUX or ThePosterDB to this title"
          aria-pressed={linkOpen}
        >
          <Link2 size={14} />
        </button>
        <button
          className={styles.panelRefresh}
          onClick={refreshSets}
          disabled={loading && !refreshing}
          title="Refresh sets"
        >
          <RefreshCw size={14} className={refreshing ? shared.spin : undefined} />
        </button>
        <button className={styles.panelClose} onClick={onClose}><X size={16} /></button>
      </div>
    </div>
  )
}
