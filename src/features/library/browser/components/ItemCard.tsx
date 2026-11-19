import { useState } from 'react'
import { Layers } from 'lucide-react'
import type { LibraryItem } from '../../../../../electron/ipc/types'
import shared from '../../libraryShared.module.css'
import styles from './ItemCard.module.css'
/** Poster-grid card for one Plex library item. */
export default function ItemCard({ item, active, onClick }: { item: LibraryItem; active: boolean; onClick: () => void }) {
  const [err, setErr]       = useState(false)
  const [loaded, setLoaded] = useState(false)
  return (
    <button className={`${styles.itemCard} ${active ? styles.itemCardActive : ''}`} onClick={onClick} title={item.title} data-item-key={item.key}>
      <div className={`${styles.itemPoster} ${!err && item.thumb && !loaded ? shared.skeleton : ''}`}>
        {!err && item.thumb ? (
          <img
            src={item.thumb}
            alt={item.title}
            loading="lazy"
            draggable={false}
            className={loaded ? '' : shared.imgPending}
            onLoad={() => setLoaded(true)}
            onError={() => setErr(true)}
          />
        ) : (
          <div className={styles.itemPosterFallback}>
            {item.type === 'collection' ? <Layers size={22} /> : item.title.charAt(0)}
          </div>
        )}
        <div className={styles.itemOverlay} aria-hidden="true">
          <span className={styles.itemOverlayHint}>Browse Sets</span>
        </div>
      </div>
      <div className={styles.itemMeta}>
        <span className={styles.itemTitle}>{item.title}</span>
        {item.type === 'collection' && item.childCount != null && (
          <span className={styles.itemYear}>{item.childCount} movie{item.childCount !== 1 ? 's' : ''}</span>
        )}
        {item.type !== 'collection' && item.year && <span className={styles.itemYear}>{item.year}</span>}
      </div>
    </button>
  )
}
