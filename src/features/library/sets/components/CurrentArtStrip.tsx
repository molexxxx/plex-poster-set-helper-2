import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ChevronDown, Image as ImageIcon } from 'lucide-react'
import Spinner from '../../../../components/ui/Spinner'
import Lightbox, { type LightboxImage } from '../../../../components/ui/Lightbox'
import type { PlexArtSlot } from '../../../../../electron/ipc/types'
import { ART_KIND_LABEL, hiResArt } from '../setsPanelUtils'
import styles from './CurrentArtStrip.module.css'
/** Collapsible strip of the item's current Plex art, clickable into a lightbox. */
export default function CurrentArtStrip({ slots, loading }: { slots: PlexArtSlot[]; loading: boolean })
{
  const [expanded, setExpanded] = useState(true)
  const [lightbox, setLightbox] = useState<number | null>(null)

  // Only slots with a thumb are viewable; the lightbox index lines up with this
  // filtered list, so each card carries its position into it.
  const lightboxImages = useMemo<LightboxImage[]>(
    () => slots.filter(s => !!s.thumb).map(s => ({
      url: hiResArt(s.thumb!),
      label: s.label,
      caption: s.season != null ? `Season ${s.season}` : ART_KIND_LABEL[s.kind],
    })),
    [slots],
  )

  if (loading)
  {
    return (
      <div className={styles.artStripSection}>
        <span className={styles.artStripLabel}>Current Plex Art</span>
        <div className={styles.artStripLoading}><Spinner size="sm" /> <span>Loading…</span></div>
      </div>
    )
  }
  if (!slots.length) return null

  let imgIdx = -1
  return (
    <div className={styles.artStripSection}>
      <button
        type="button"
        className={styles.artStripHeader}
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse current art' : 'Expand current art'}
      >
        <ChevronDown
          size={13}
          className={`${styles.artStripChevron} ${expanded ? '' : styles.artStripChevronCollapsed}`}
        />
        <span className={styles.artStripLabel}>Current Plex Art</span>
        <span className={styles.artStripCount}>{slots.length}</span>
      </button>
      <div className={`${styles.artStripBody} ${expanded ? '' : styles.artStripBodyCollapsed}`}>
        <div className={styles.artStripScroll}>
          <div className={styles.artStrip}>
            {slots.map(s =>
            {
              const i = s.thumb ? ++imgIdx : -1
              return (
                <div
                  key={`${s.kind}-${s.key}`}
                  className={`${styles.artCard} ${s.highlight ? styles.artHighlight : ''} ${s.thumb ? styles.artCardClickable : ''}`}
                  title={s.label}
                  {...(s.thumb
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        onClick: () => setLightbox(i),
                        onKeyDown: (e: React.KeyboardEvent) =>
                        {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(i) }
                        },
                      }
                    : {})}
                >
                  {s.thumb ? (
                    <img src={s.thumb} alt={s.label} className={styles.artCardImg} loading="lazy" draggable={false} />
                  ) : (
                    <div className={styles.artCardFallback}><ImageIcon size={16} /></div>
                  )}
                  <span className={styles.artLabel}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
