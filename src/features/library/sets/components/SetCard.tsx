import { useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, CalendarClock, Check, ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, Image as ImageIcon, Link2, Link2Off, Loader2,
  Star, Upload, User,
} from 'lucide-react'
import Badge from '../../../../components/ui/Badge'
import Button from '../../../../components/ui/Button'
import Checkbox from '../../../../components/ui/Checkbox'
import Lightbox, { type LightboxImage } from '../../../../components/ui/Lightbox'
import type { PosterSetSummary } from '../../../../../electron/ipc/types'
import {
  SOURCE_LABEL, SOURCE_SHORT, defaultVariant, groupPosters, posterPageUrl, setKey, variantClusters, variantKey,
  type ApplyContext, type FileType, type SetApplyScope,
} from '../../../../utils/posterGroups'
import type { CreatorState } from '../../../../utils/creatorPrefs'
import { CreatorNav, ThumbButton, creatorUrl, type ApplyState } from '../../libraryShared'
import ApplyScopeOptions from './ApplyScopeOptions'
import shared from '../../libraryShared.module.css'
import styles from './SetCard.module.css'
/** Expandable card for one poster set: preview, uploader, source, counts, apply state, and grouped posters. */
export default function SetCard({ set, apply, onApply, enabledTypes, title, badge, disabled, creator = 'none', onCreatorChange, showSource, selectable, checked, onToggleSelect, onSchedule, scheduledBy, onOpenSchedule, scheduleHint, scheduleError, scheduling, collectionMovies, collectionTotal, hasCollectionArt, collectionMissing, applyScope, scopeContext, onApplyScopeChange, linked, onUnlink, variantContext, itemTitle, picks, onPick }: {
  set: PosterSetSummary
  apply?: ApplyState
  onApply: () => void
  enabledTypes: Set<FileType>
  /** When shown (Creators view), the heading is the media title. */
  title?: string
  /** Optional match/applied badge. */
  badge?: React.ReactNode
  /** Disables Apply (e.g. no library match). */
  disabled?: boolean
  /** Whether the uploader is followed or hidden. */
  creator?: CreatorState
  /** Follow, hide or reset the uploader; omit to show no creator controls. */
  onCreatorChange?: (state: CreatorState) => void
  /** Tag the card with its site; for lists that mix MediUX and ThePosterDB. */
  showSource?: boolean
  /** Shows a selection checkbox (Creators sync). */
  selectable?: boolean
  checked?: boolean
  onToggleSelect?: () => void
  /** Creates a sync job for this set (library view). */
  onSchedule?: () => void
  /** Name and schedule of the job that already syncs this set. */
  scheduledBy?: string
  /** Opens the covering job in the Scheduler. */
  onOpenSchedule?: () => void
  /** Plain-language schedule a new job would use. */
  scheduleHint?: string
  /** Why the last schedule request for this set failed. */
  scheduleError?: string
  /** A schedule request for this set is in flight. */
  scheduling?: boolean
  /** How many of this collection set's movies are in the library (the spread target count). */
  collectionMovies?: number
  /** Total movies the collection set spans, including any not in the library. */
  collectionTotal?: number
  /** Set includes a collection-level poster (applied to the Plex Collection object). */
  hasCollectionArt?: boolean
  /** No Plex Collection matches the set's collection poster, so it cannot be applied. */
  collectionMissing?: boolean
  /** Independent movie / collection-poster apply choices. */
  applyScope?: SetApplyScope
  /** Whether scope labels refer to a Plex Collection or a single movie. */
  scopeContext?: 'movie' | 'collection'
  onApplyScopeChange?: (patch: Partial<SetApplyScope>) => void
  /** The set came from a link the user attached to this title. */
  linked?: boolean
  /** Detaches that link. */
  onUnlink?: () => void
  /** Offers a pick when several posters in the set compete for one Plex slot; omit to show none. */
  variantContext?: ApplyContext
  /** The viewed item's title, so the collection poster named after it is the default pick. */
  itemTitle?: string
  /** Chosen poster URL by slot key (see variantKey). */
  picks?: Record<string, string>
  onPick?: (slot: string, url: string) => void
}) {
  const [err, setErr]               = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  // A ThePosterDB avatar can be the fallback CDN guess, which 403s for users
  // without an upload. Remembered per URL, so a refreshed avatar gets a new try.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const status = apply?.status ?? 'idle'
  const openCreator = useContext(CreatorNav)
  const isPosterdb = set.source === 'posterdb'
  // Radio groups must not collide when both sites contribute a set numbered the same.
  const scopeName = `scope-movies-${setKey(set)}`

  const scopeBlocksApply = applyScope != null
    && applyScope.movies === 'none'
    && !applyScope.collectionPoster
  const applyDisabled = disabled || scopeBlocksApply

  const groups = useMemo(() => groupPosters(set.posters), [set.posters])
  // Only the groups whose file type is enabled by the type chips; the preview,
  // counts and lightbox all key off this so the filter drives what's shown.
  const visibleGroups = useMemo(() => groups.filter(g => enabledTypes.has(g.kind)), [groups, enabledTypes])
  const totalCount = visibleGroups.reduce((n, g) => n + g.posters.length, 0)

  // Flattened poster list in group order for the full-screen lightbox
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxImages = useMemo<LightboxImage[]>(
    () => visibleGroups.flatMap(g => g.posters.map(p => ({
      url: p.url,
      label: g.label,
      caption: p.episode != null ? `Episode ${p.episode}` : (p.title || undefined),
    }))),
    [visibleGroups],
  )

  return (
    <div className={`${styles.setCard} ${creator === 'followed' ? styles.setCardFollowed : ''} ${creator === 'hidden' ? styles.setCardHidden : ''} ${checked ? styles.setCardChecked : ''}`}>
      <div className={styles.setRow}>
        {selectable && (
          <div className={styles.setSelect}>
            <Checkbox checked={!!checked} onChange={() => onToggleSelect?.()} />
          </div>
        )}
        <div className={`${styles.setPreview} ${!err && set.previewUrl && !previewLoaded ? styles.skeleton : ''}`}>
          {!err && set.previewUrl ? (
            <img
              src={set.previewUrl}
              alt={set.setName}
              loading="lazy"
              draggable={false}
              className={previewLoaded ? '' : styles.imgPending}
              onLoad={() => setPreviewLoaded(true)}
              onError={() => setErr(true)}
            />
          ) : (
            <div className={styles.setPreviewFallback}><ImageIcon size={18} /></div>
          )}
        </div>

        <div className={styles.setInfo}>
          {title && <div className={styles.setHeadingRow}><span className={styles.setTitle}>{title}</span>{badge}</div>}

          <div className={styles.setUploaderRow}>
            <button
              className={`${styles.setUploader} ${styles.uploaderLink}`}
              // The Creators tab browses MediUX only, so a ThePosterDB uploader
              // opens their profile on ThePosterDB instead of a tab that would
              // come back empty.
              onClick={() => isPosterdb
                ? window.api.app.openExternal(creatorUrl(set.source, set.uploader))
                : openCreator(set.uploader)}
              title={isPosterdb ? `Open ${set.uploader} on ThePosterDB` : `View ${set.uploader} in Creators`}
            >
              {set.uploaderAvatar && failedAvatar !== set.uploaderAvatar ? (
                <img className={styles.avatar} src={set.uploaderAvatar} alt={set.uploader} onError={() => setFailedAvatar(set.uploaderAvatar ?? null)} />
              ) : (
                <div className={styles.avatarFallback}><User size={11} /></div>
              )}
              <span className={styles.uploaderName}>{set.uploader}</span>
              {creator === 'followed' && !onCreatorChange && <Star size={10} className={styles.followStar} />}
            </button>
            {showSource && <Badge variant={set.source}>{SOURCE_SHORT[set.source]}</Badge>}
            {linked && (
              <span className={styles.linkedBadge} title={set.linkedFrom ? `Linked from ${set.linkedFrom}` : 'Linked to this title'}>
                <Link2 size={10} /> Linked
              </span>
            )}
            {onCreatorChange && (
              // Both toggles depict state, like the star: lit when on. The
              // accessible name stays constant and aria-pressed carries the state.
              <div className={styles.creatorActions}>
                <button
                  className={`${styles.creatorAction} ${creator === 'followed' ? styles.creatorActionOn : ''}`}
                  onClick={() => onCreatorChange(creator === 'followed' ? 'none' : 'followed')}
                  title={creator === 'followed' ? `Unfollow ${set.uploader}` : `Follow ${set.uploader}: their sets come first and are highlighted`}
                  aria-label={`Follow ${set.uploader}`}
                  aria-pressed={creator === 'followed'}
                >
                  <Star size={12} fill={creator === 'followed' ? 'currentColor' : 'none'} />
                </button>
                <button
                  className={`${styles.creatorAction} ${creator === 'hidden' ? styles.creatorActionOn : ''}`}
                  onClick={() => onCreatorChange(creator === 'hidden' ? 'none' : 'hidden')}
                  title={creator === 'hidden' ? `Unhide ${set.uploader}` : `Hide ${set.uploader}'s sets`}
                  aria-label={`Hide ${set.uploader}`}
                  aria-pressed={creator === 'hidden'}
                >
                  {creator === 'hidden' ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            )}
            {onUnlink && (
              <button
                className={styles.unlinkAction}
                onClick={onUnlink}
                title="Unlink this set from the title"
                aria-label="Unlink this set from the title"
              >
                <Link2Off size={12} />
              </button>
            )}
            {!title && badge && <span className={styles.setTrailing}>{badge}</span>}
          </div>

          <div className={styles.setCounts}>
            {enabledTypes.has('poster')     && set.posterCount > 0    && <span className={styles.countBadge}>{set.posterCount} poster{set.posterCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('title_card') && set.titleCardCount > 0 && <span className={styles.countBadge}>{set.titleCardCount} card{set.titleCardCount !== 1 ? 's' : ''}</span>}
            {enabledTypes.has('backdrop')   && set.backdropCount > 0  && <span className={styles.countBadge}>{set.backdropCount} backdrop{set.backdropCount !== 1 ? 's' : ''}</span>}
            {set.downloads != null && <span className={styles.countBadge} title="Downloads on MediUX">{set.downloads.toLocaleString()} download{set.downloads !== 1 ? 's' : ''}</span>}
          </div>

          <div className={styles.setActions}>
            {status === 'idle' && (
              <Button variant="primary" size="sm" icon={<Upload size={12} />} onClick={onApply} disabled={applyDisabled}>Apply</Button>
            )}
            {status === 'applying' && (
              <span className={styles.applyProgress}><Loader2 size={13} className={shared.spin} /> {apply!.done}/{apply!.total}</span>
            )}
            {status === 'done' && (
              <span className={styles.applyDone}><Check size={13} /> Applied {apply!.done}{apply!.error ? ` · ${apply!.error}` : ''}</span>
            )}
            {status === 'error' && (
              <span className={styles.applyError}><AlertCircle size={13} /> {apply!.error ?? 'Failed'}
                <button className={styles.retry} onClick={onApply}>Retry</button>
              </span>
            )}
            {onSchedule && !disabled && (
              scheduledBy
                ? <button className={styles.scheduledTag} onClick={onOpenSchedule} title={`Synced by ${scheduledBy}. Click to open it in the Scheduler.`}>
                    <CalendarClock size={12} /> Scheduled
                  </button>
                : <button
                    className={styles.scheduleBtn}
                    onClick={onSchedule}
                    disabled={scheduling}
                    title={`Apply new artwork from this set automatically${scheduleHint ? ` (${scheduleHint})` : ''}`}
                  >
                    {scheduling ? <Loader2 size={12} className={shared.spin} /> : <CalendarClock size={12} />} Schedule
                  </button>
            )}
            {set.setUrl && (
              <button
                className={styles.openSetBtn}
                onClick={() => window.api.app.openExternal(set.setUrl!)}
                title={`Open this set on ${SOURCE_LABEL[set.source]}`}
                aria-label={`Open this set on ${SOURCE_LABEL[set.source]}`}
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
          {scheduleError && (
            <div className={styles.scheduleError} role="alert">
              <AlertCircle size={12} /> Couldn&apos;t schedule: {scheduleError}
            </div>
          )}
        </div>
      </div>

      {applyScope && onApplyScopeChange && (
        <ApplyScopeOptions
          applyScope={applyScope}
          onApplyScopeChange={onApplyScopeChange}
          collectionMovies={collectionMovies}
          collectionTotal={collectionTotal}
          scopeContext={scopeContext}
          hasCollectionArt={hasCollectionArt}
          collectionMissing={collectionMissing}
          scopeName={scopeName}
        />
      )}
      <button className={`${styles.setExpandBar} ${open ? styles.setExpandBarOpen : ''}`} onClick={() => setOpen(v => !v)}>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{open ? 'Hide posters' : `Preview ${totalCount} poster${totalCount !== 1 ? 's' : ''}`}</span>
      </button>

      {/* Grouped contents; posters never mixed across types */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.setGroups}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {(() => {
              let flat = -1
              return visibleGroups.map(g => {
                // Posters competing for one Plex slot: only one of them is
                // applied, so the group offers a pick.
                const clusters = variantContext ? variantClusters(g.posters, variantContext) : null
                const hasChoice = !!clusters && [...clusters.values()].some(c => c.length > 1)
                return (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>
                      {g.label}
                      <span className={styles.groupCount}>{g.posters.length}</span>
                      {hasChoice && <span className={styles.groupHint}>One is applied: pick it</span>}
                    </div>
                    <div className={`${shared.groupThumbs} ${g.kind === 'title_card' || g.kind === 'backdrop' ? shared.groupThumbsWide : ''}`}>
                      {g.posters.map(p => {
                        flat++
                        const idx = flat
                        const slot = variantContext ? variantKey(p, variantContext) : ''
                        const cluster = clusters?.get(slot)
                        const choosable = !!cluster && cluster.length > 1
                        const chosen = choosable ? (picks?.[slot] ?? defaultVariant(cluster, itemTitle).url) : undefined
                        return (
                          <ThumbButton
                            key={p.url}
                            url={p.thumbUrl ?? p.url}
                            label={g.label}
                            episode={p.episode}
                            onClick={() => setLightbox(idx)}
                            selectable={choosable}
                            selected={chosen === p.url}
                            onSelect={() => onPick?.(slot, p.url)}
                            pageUrl={posterPageUrl(p, set.setUrl)}
                            site={SOURCE_LABEL[p.source]}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={lightboxImages} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
