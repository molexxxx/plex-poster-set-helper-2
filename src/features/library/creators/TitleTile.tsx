import { useState } from 'react'
import { AlertCircle, CalendarClock, Check, CheckCircle2, Image as ImageIcon, Loader2, Upload } from 'lucide-react'
import type { MediuxUserSet } from '../../../../electron/ipc/types'
import { coveringJob, type ScheduleCoverage } from '../../../../electron/services/scheduleUtils'
import { setKey } from '../../../utils/posterGroups'
import { appliedKey, type AppliedIndex } from '../../../utils/appliedTracker'
import type { ApplyState } from '../libraryShared'
import { plural, type TitleGroup } from './catalogUtils'
import shared from './catalogShared.module.css'
import tiles from './tiles.module.css'
import styles from './TitleTile.module.css'
interface TitleTileProps {
  group: TitleGroup
  /** The variant shown and applied; the group's first set until another is picked. */
  set: MediuxUserSet
  username: string
  appliedIdx: AppliedIndex
  coverage: ScheduleCoverage
  apply?: ApplyState
  selecting: boolean
  checked: boolean
  open: boolean
  onOpen: () => void
  onPick: (setId: string) => void
  onToggleSelect: () => void
  onApply: () => void
  /** Names the types Apply uses when some are switched off. */
  applyHint?: string
}

const MAX_SWATCHES = 5

/** One title on the poster wall: the picked set's art, with Apply on the art and the other sets as swatches. */
export default function TitleTile({ group, set, username, appliedIdx, coverage, apply, selecting, checked, open, onOpen, onPick, onToggleSelect, onApply, applyHint }: TitleTileProps) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const current = group.matchedKey ? appliedIdx.currentByItem.get(group.matchedKey) : undefined
  const setIsCurrent = setKey(set) === current
  const otherIsCurrent = !setIsCurrent && group.sets.some(s => setKey(s) === current)
  const hasOtherArt = !current && !!group.matchedKey && appliedIdx.titles.has(appliedKey(group.title, group.year))
  const synced = group.sets.some(s => !!coveringJob(coverage, s.id, username))
  const inLibrary = !!group.matchedKey
  const canApply = inLibrary || set.posters.some(p => p.isCollection)
  const status = apply?.status ?? 'idle'
  const heading = group.year ? `${group.title} (${group.year})` : group.title
  const fileCount = set.posters.length
  const meta = !inLibrary
    ? `${group.year ?? ''}${group.year ? ' · ' : ''}Not in library`
    : group.sets.length > 1
      ? `${group.year ?? ''}${group.year ? ' · ' : ''}${group.sets.length} sets`
      : `${group.year ?? ''}${group.year ? ' · ' : ''}${plural(fileCount, 'file')}`
  const extra = group.sets.length - MAX_SWATCHES

  return (
    <div className={`${tiles.tile} ${open ? tiles.tileOpen : ''} ${checked ? tiles.tileChecked : ''} ${inLibrary ? '' : tiles.tileMissing} ${status !== 'idle' ? tiles.tileBusy : ''}`}>
      <div className={tiles.poster}>
        <button
          type="button"
          className={tiles.posterButton}
          onClick={selecting && inLibrary ? onToggleSelect : onOpen}
          aria-expanded={selecting ? undefined : open}
          aria-pressed={selecting ? checked : undefined}
          aria-label={selecting ? `Select ${heading}` : `${heading}: show sets and files`}
          title={group.sets.length > 1 ? `${heading} · ${set.setName}` : heading}
        >
          {set.previewUrl && !broken ? (
            <img
              src={set.previewUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className={loaded ? tiles.artLoaded : tiles.artPending}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          ) : (
            <span className={tiles.artFallback}><ImageIcon size={22} aria-hidden /></span>
          )}
        </button>

        <div className={tiles.posterTop}>
          {selecting
            ? inLibrary && <span className={`${styles.check} ${checked ? styles.checkOn : ''}`} aria-hidden>{checked && <Check size={12} strokeWidth={3} />}</span>
            : setIsCurrent || status === 'done'
              ? <span className={`${tiles.pill} ${tiles.pillSuccess}`}><CheckCircle2 size={11} aria-hidden /> Applied</span>
              : otherIsCurrent
                ? <span className={tiles.pill}>Other set applied</span>
                : hasOtherArt && <span className={tiles.pill}>Other art</span>}
          {synced && !selecting && <span className={`${tiles.pill} ${tiles.pillIcon}`} title="Synced on a schedule"><CalendarClock size={11} aria-hidden /><span className={shared.srOnly}>Synced</span></span>}
        </div>

        {!selecting && canApply && (
          <div className={tiles.posterActions}>
            {status === 'applying' ? (
              <span className={tiles.overlayStatus}><Loader2 size={12} className={shared.spin} aria-hidden /> {apply!.done}/{apply!.total}</span>
            ) : status === 'error' ? (
              <button type="button" className={`${tiles.overlayButton} ${tiles.overlayError}`} onClick={onApply} title={apply!.error}>
                <AlertCircle size={12} aria-hidden /> Retry
              </button>
            ) : status === 'done' ? (
              <span className={tiles.overlayStatus} title={apply!.error}><Check size={12} aria-hidden /> Applied {apply!.done}{apply!.error ? ', some failed' : ''}</span>
            ) : (
              <button type="button" className={tiles.overlayButton} onClick={onApply} aria-label={`Apply ${set.setName}`} title={applyHint}>
                <Upload size={12} aria-hidden /> Apply
              </button>
            )}
          </div>
        )}
      </div>

      <div className={tiles.tileText}>
        <span className={tiles.tileTitle} title={heading}>{group.title}</span>
        <span className={tiles.tileMeta} title={meta}>{meta}</span>
      </div>

      {group.sets.length > 1 && (
        <div className={styles.swatches} role="radiogroup" aria-label={`Sets for ${heading}`}>
          {group.sets.slice(0, MAX_SWATCHES).map(s => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === set.id}
              aria-label={s.setName}
              title={s.setName}
              className={`${styles.swatch} ${s.id === set.id ? styles.swatchOn : ''}`}
              onClick={() => onPick(s.id)}
            >
              {s.previewUrl ? <img src={s.previewUrl} alt="" loading="lazy" draggable={false} /> : <ImageIcon size={10} aria-hidden />}
              {setKey(s) === current && <span className={styles.swatchCurrent} aria-hidden />}
            </button>
          ))}
          {extra > 0 && (
            <button type="button" className={styles.swatchMore} onClick={onOpen} aria-label={`${extra} more sets; show all`}>
              +{extra}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
