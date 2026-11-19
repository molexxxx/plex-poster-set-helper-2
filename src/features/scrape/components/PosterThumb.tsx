import { useState } from 'react'
import { Upload, CheckCircle2, AlertCircle, Loader2, Maximize2, Library, BadgeCheck, Download } from 'lucide-react'
import { posterLabel, shortReason } from '../queueText'
import { uploadPoster, type PatchPoster } from '../uploadPoster'
import type { PosterResult } from '../hooks/useScrapeStore'
import styles from './PosterThumb.module.css'

/** Poster thumbnail with upload status overlay, applied badges, and lightbox zoom. */
export default function PosterThumb({
  poster,
  entryId,
  patchPoster,
  onView,
  inLibrary,
  applied,
  downloaded,
  setId,
  wide,
}: {
  poster: PosterResult
  entryId: string
  patchPoster: PatchPoster
  onView: () => void
  inLibrary?: boolean
  applied?: boolean
  downloaded?: boolean
  setId?: string
  /** Backdrops and title cards, shown 16:9 instead of 2:3. */
  wide?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const us = poster.uploadStatus

  const overlayIcon =
    us === 'matching' || us === 'uploading' ? <Loader2 size={14} className={styles.spin} /> :
    us === 'done'     ? <CheckCircle2 size={14} /> :
    us === 'error'    ? <AlertCircle size={13} /> :
    us === 'no_match' ? <AlertCircle size={13} /> :
    null

  const overlayClass =
    us === 'done'     ? styles.overlayDone :
    us === 'error' || us === 'no_match' ? styles.overlayError :
    us === 'matching' || us === 'uploading' ? styles.overlayPending :
    ''

  // Human-readable error reason shown in tooltip and inside the overlay
  const errorReason =
    us === 'no_match' ? 'Not in library' :
    us === 'error'    ? (poster.uploadError ?? 'Upload failed') :
    null

  const thumbTitle = errorReason
    ? `${posterLabel(poster)}\n${errorReason}`
    : posterLabel(poster)

  return (
    <div
      className={wide ? `${styles.thumb} ${styles.thumbWide}` : styles.thumb}
      title={thumbTitle}
      onClick={() => {
        if (us === 'idle' || us === 'error' || us === 'no_match') {
          uploadPoster(entryId, poster, patchPoster, setId)
        }
      }}
    >
      {!imgError && poster.thumbUrl ? (
        <img
          src={poster.thumbUrl}
          alt={posterLabel(poster)}
          className={styles.thumbImg}
          onError={() => setImgError(true)}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className={styles.thumbFallback}>
          <span className={styles.thumbInitial}>
            {poster.title.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* upload status overlay */}
      {overlayIcon && (
        <div className={[styles.overlay, overlayClass, errorReason ? styles.overlayErrorState : ''].filter(Boolean).join(' ')}>
          {overlayIcon}
          {errorReason && (
            <span className={styles.overlayErrorText}>{shortReason(errorReason)}</span>
          )}
        </div>
      )}

      {/* idle hover hint */}
      {us === 'idle' && (
        <div className={styles.overlayHover}>
          <Upload size={12} />
        </div>
      )}

      {/* status: current poster (Applied) > previously applied (Downloaded) > same-title (soft) */}
      {applied ? (
        <div className={styles.appliedBadge} title="This poster is currently applied in your library">
          <BadgeCheck size={11} /> Applied
        </div>
      ) : downloaded ? (
        <div className={styles.downloadedBadge} title="Uploaded before, but a newer poster is currently applied">
          <Download size={10} /> Downloaded
        </div>
      ) : inLibrary ? (
        <div className={styles.inLibBadge} title="You've already applied art to this title">
          <Library size={10} />
        </div>
      ) : null}

      {/* zoom to view the full image (doesn't trigger upload) */}
      <button className={styles.zoomBtn} title="View full size" onClick={e => { e.stopPropagation(); onView() }}>
        <Maximize2 size={11} />
      </button>
    </div>
  )
}
