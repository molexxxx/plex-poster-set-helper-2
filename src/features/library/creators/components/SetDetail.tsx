import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertCircle, Check, CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, Upload, X } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import Lightbox, { type LightboxImage } from '../../../../components/ui/Lightbox'
import TypeToggles from '../../../../components/ui/TypeToggles'
import type { MediuxUserSet } from '../../../../../electron/ipc/types'
import { SOURCE_LABEL, groupPosters, posterPageUrl, setKey, type FileType } from '../../../../utils/posterGroups'
import type { AppliedIndex } from '../../../../utils/appliedTracker'
import { ThumbButton, type ApplyState } from '../../libraryShared'
import { count, plural, shortTypeCounts, type TitleGroup } from '../catalogUtils'
import libraryStyles from '../../libraryShared.module.css'
import shared from './catalogShared.module.css'
import tiles from './tiles.module.css'
import styles from './SetDetail.module.css'
interface SetDetailProps
{
  group: TitleGroup
  set: MediuxUserSet
  appliedIdx: AppliedIndex
  enabledTypes: Set<FileType>
  onTypesChange: (types: Set<FileType>) => void
  apply?: ApplyState
  onPick: (setId: string) => void
  onApply: () => void
  onClose: () => void
}

/** The shelf that opens under a title's row: the picked set large, every set for the title, and its files. */
export default function SetDetail({ group, set, appliedIdx, enabledTypes, onTypesChange, apply, onPick, onApply, onClose }: SetDetailProps)
{
  const ref = useRef<HTMLElement>(null)
  const headingId = useId()
  const typesLabelId = useId()
  const heading = group.year ? `${group.title} (${group.year})` : group.title
  const [lightbox, setLightbox] = useState<number | null>(null)
  const fileRows = useMemo(() =>
  {
    const groups = groupPosters(set.posters).filter(g => enabledTypes.has(g.kind))
    const posterItems = groups.filter(g => g.kind === 'poster')
      .flatMap(g => g.posters.map(p => ({ poster: p, caption: g.label.replace(/ Poster$/, '') })))
    const rows = posterItems.length ? [{ label: 'Posters', kind: 'poster' as FileType, items: posterItems }] : []
    for (const g of groups.filter(gr => gr.kind !== 'poster'))
    {
      rows.push({ label: g.label === 'Backdrop' ? 'Backdrops' : g.label, kind: g.kind, items: g.posters.map(p => ({ poster: p, caption: '' })) })
    }
    return rows
  }, [set.posters, enabledTypes])
  const images = useMemo<LightboxImage[]>(
    () => fileRows.flatMap(r => r.items.map(({ poster, caption }) => ({
      url: poster.url,
      label: heading,
      caption: poster.episode != null ? `${r.label}, episode ${poster.episode}` : caption || r.label,
    }))),
    [fileRows, heading],
  )
  const current = group.matchedKey ? appliedIdx.currentByItem.get(group.matchedKey) : undefined
  const status = apply?.status ?? 'idle'
  const canApply = !!group.matchedKey || set.posters.some(p => p.isCollection)

  useEffect(() =>
  {
    const el = ref.current
    const list = el?.closest<HTMLElement>('[data-scroll-list]')
    if (!el || !list) return
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (top > list.clientHeight - 220) list.scrollBy({ top: top - list.clientHeight * 0.35, behavior: 'smooth' })
  }, [])

  let flat = -1
  return (
    <section
      ref={ref}
      className={styles.detail}
      aria-labelledby={headingId}
      onKeyDown={e => { if (e.key === 'Escape' && lightbox === null) { e.stopPropagation(); onClose() } }}
    >
      <div className={styles.detailArt}>
        {set.previewUrl ? <img src={set.previewUrl} alt="" draggable={false} /> : <span className={tiles.artFallback}><ImageIcon size={26} aria-hidden /></span>}
      </div>

      <div className={styles.detailBody}>
        <div className={styles.detailHead}>
          <div className={styles.detailHeading}>
            <h3 id={headingId} className={styles.detailTitle}>{heading}</h3>
            <p className={styles.detailSub}>
              {set.setName} · {shortTypeCounts(set)}
              {set.downloads != null && ` · ${plural(set.downloads, 'download')}`}
            </p>
            <p className={styles.detailState}>
              {!group.matchedKey
                ? 'Not in your library'
                : setKey(set) === current
                  ? <span className={shared.applyDone}><CheckCircle2 size={12} aria-hidden /> This set is on Plex now</span>
                  : appliedIdx.setKeys.has(setKey(set)) ? 'Applied before; other art is on Plex now' : 'In your library'}
            </p>
          </div>
          <div className={styles.detailActions}>
            {status === 'applying' ? (
              <span className={shared.applyProgress}><Loader2 size={12} className={shared.spin} aria-hidden /> Applying {apply!.done}/{apply!.total}</span>
            ) : status === 'done' ? (
              <span className={shared.applyDone} title={apply!.error}><Check size={12} aria-hidden /> Applied {apply!.done}{apply!.error ? ` · ${apply!.error}` : ''}</span>
            ) : status === 'error' ? (
              <span className={shared.applyError}><AlertCircle size={12} aria-hidden /> {apply!.error ?? 'Failed'} <button type="button" className={shared.inlineAction} onClick={onApply}>Retry</button></span>
            ) : (
              <Button variant="primary" size="sm" icon={<Upload size={12} />} onClick={onApply} disabled={!canApply} title={canApply ? undefined : 'Not in your library'}>
                Apply set
              </Button>
            )}
            {set.setUrl && (
              <Button variant="ghost" size="sm" icon={<ExternalLink size={12} />} onClick={() => window.api.app.openExternal(set.setUrl!)}>MediUX</Button>
            )}
            <button type="button" className={styles.iconAction} onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={15} /></button>
          </div>
        </div>

        {group.sets.length > 1 && (
          <div className={styles.detailSets} role="radiogroup" aria-label={`Sets for ${heading}`}>
            {group.sets.map(s => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === set.id}
                className={`${styles.detailSet} ${s.id === set.id ? styles.detailSetOn : ''}`}
                onClick={() => onPick(s.id)}
              >
                <span className={styles.detailSetArt}>{s.previewUrl ? <img src={s.previewUrl} alt="" loading="lazy" draggable={false} /> : <ImageIcon size={12} aria-hidden />}</span>
                <span className={styles.detailSetText}>
                  <span className={styles.detailSetName}>{s.setName}</span>
                  <span className={styles.detailSetMeta}>{setKey(s) === current ? 'On Plex now' : shortTypeCounts(s)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.detailTypes}>
          <span id={typesLabelId} className={styles.fileGroupLabel}>Types to apply</span>
          <TypeToggles value={enabledTypes} onChange={onTypesChange} ariaLabelledBy={typesLabelId} />
        </div>

        {fileRows.length === 0 && <p className={styles.detailSub}>This set has none of the types picked above.</p>}
        {fileRows.map(row => (
          <div key={row.label} className={styles.fileGroup}>
            <span className={styles.fileGroupLabel}>{row.label}<span className={shared.tabCount}>{count(row.items.length)}</span></span>
            <div className={`${libraryStyles.groupThumbs} ${row.kind === 'poster' ? '' : libraryStyles.groupThumbsWide}`}>
              {row.items.map(({ poster, caption }) =>
              {
                flat++
                const idx = flat
                const thumb = (
                  <ThumbButton
                    key={poster.url}
                    url={poster.thumbUrl ?? poster.url}
                    label={caption || row.label}
                    episode={poster.episode}
                    onClick={() => setLightbox(idx)}
                    pageUrl={posterPageUrl(poster, set.setUrl)}
                    site={SOURCE_LABEL[poster.source]}
                  />
                )
                return caption
                  ? <figure key={poster.url} className={styles.thumbCell}>{thumb}<figcaption className={styles.thumbCaption}>{caption}</figcaption></figure>
                  : thumb
              })}
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {lightbox !== null && <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </section>
  )
}
