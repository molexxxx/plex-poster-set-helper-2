import { useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import type { MediuxUserSet, PosterInfo } from '../../../../electron/ipc/types'
import type { ApplyState } from '../libraryShared'
import shared from './catalogShared.module.css'
import styles from './tiles.module.css'
/** A single poster, backdrop, or title card, with Apply on the art. */
export default function FileTile({ set, poster, state, applied, onOpen, onApply }: {
  set: MediuxUserSet
  poster: PosterInfo
  state?: ApplyState
  applied: boolean
  onOpen: () => void
  onApply: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const title = set.year ? `${set.title} (${set.year})` : set.title
  const caption = poster.episode != null
    ? `${typeof poster.season === 'number' ? `S${poster.season} ` : ''}E${poster.episode}`
    : typeof poster.season === 'number' ? (poster.season === 0 ? 'Specials' : `Season ${poster.season}`) : null
  const inLibrary = !!set.matchedKey || !!poster.isCollection
  const status = state?.status ?? 'idle'

  return (
    <div className={`${styles.tile} ${inLibrary ? '' : styles.tileMissing} ${status !== 'idle' ? styles.tileBusy : ''}`}>
      <div className={styles.poster}>
        <button type="button" className={styles.posterButton} onClick={onOpen} aria-label={`View ${title}${caption ? `, ${caption}` : ''}`}>
          <img
            src={poster.thumbUrl ?? poster.url}
            alt=""
            loading="lazy"
            draggable={false}
            className={loaded ? styles.artLoaded : styles.artPending}
            onLoad={() => setLoaded(true)}
          />
        </button>
        <div className={styles.posterTop}>
          {(applied || status === 'done') && <span className={`${styles.pill} ${styles.pillSuccess}`}><CheckCircle2 size={11} aria-hidden /> Applied</span>}
        </div>
        {inLibrary && !applied && (
          <div className={styles.posterActions}>
            {status === 'applying' ? (
              <span className={styles.overlayStatus}><Loader2 size={12} className={shared.spin} aria-hidden /> Applying</span>
            ) : status === 'error' ? (
              <button type="button" className={`${styles.overlayButton} ${styles.overlayError}`} onClick={onApply} title={state?.error}>
                <AlertCircle size={12} aria-hidden /> Retry
              </button>
            ) : status !== 'done' && (
              <button type="button" className={styles.overlayButton} onClick={onApply} aria-label={`Apply ${title}${caption ? ` ${caption}` : ''}`}>
                <Upload size={12} aria-hidden /> Apply
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.tileText}>
        <span className={styles.tileTitleRow}>
          <span className={styles.tileTitle} title={title}>{set.title}</span>
          {caption && <span className={styles.tileCaption}>{caption}</span>}
        </span>
        {!inLibrary && <span className={styles.tileMeta}>Not in library</span>}
      </div>
    </div>
  )
}
