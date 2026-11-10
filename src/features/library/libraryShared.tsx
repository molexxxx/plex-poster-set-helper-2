import { createContext, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react'
import { posterFileType, type FileType, type SetSource } from '../../utils/posterGroups'
import { posterSlot } from '../../../electron/services/scheduleUtils'
import type { PosterInfo } from '../../../electron/ipc/types'
import styles from './LibraryPage.module.css'

/** A creator's page on the site their set came from. */
export function creatorUrl(source: SetSource, uploader: string): string {
  return source === 'posterdb'
    ? `https://theposterdb.com/user/${encodeURIComponent(uploader)}`
    : `https://mediux.pro/user/${encodeURIComponent(uploader)}`
}

/**
 * Compact relative time for the "checked" stamp.
 *
 * @param ts - Epoch milliseconds of the check.
 * @returns A short label like "5m ago".
 */
export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Apply progress for a single set. */
export interface ApplyState { status: 'idle' | 'applying' | 'done' | 'error'; done: number; total: number; error?: string }

/**
 * Error text for a finished apply: upload failures first, then targets that
 * were skipped, then a failure to save the history that drives the Applied
 * badges and filters.
 *
 * @param failed - Posters that failed to upload.
 * @param historyError - Why the history write failed, if it did.
 * @param skipped - Why each skipped target was left alone.
 * @returns The text, or undefined when everything went through.
 */
export function applyError(failed: number, historyError?: string, skipped: string[] = []): string | undefined {
  const parts: string[] = []
  if (failed) parts.push(`${failed} failed`)
  parts.push(...skipped)
  if (historyError) parts.push(`history not saved: ${historyError}`)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * Applies a set's posters to a Plex target, routing each by season/episode.
 *
 * @param targetKey - Plex ratingKey to apply onto.
 * @param posters - Candidate posters; filtered by the enabled types.
 * @param enabled - File types the user has switched on.
 * @param onProgress - Called after each poster with done/total counts.
 * @returns Done/failed counts, the URLs and slots actually applied, and the last error.
 */
export async function applyPosters(
  targetKey: string,
  posters: PosterInfo[],
  enabled: Set<FileType>,
  onProgress: (done: number, total: number) => void,
): Promise<{ done: number; failed: number; total: number; appliedUrls: string[]; appliedSlots: string[]; lastError?: string }> {
  const list = posters.filter(p => enabled.has(posterFileType(p)))
  let done = 0, failed = 0
  const appliedUrls: string[] = []
  const appliedSlots: string[] = []
  let lastError: string | undefined
  for (const p of list) {
    try {
      const res = await window.api.plex.uploadPoster(targetKey, p.url, p.source, p.season, p.episode, p.isCollection, p.year ? `${p.title} (${p.year})` : p.title) as { success: boolean; error?: string }
      if (res.success) { done++; appliedUrls.push(p.url); appliedSlots.push(posterSlot(p)) } else { failed++; lastError = res.error }
    } catch (err) { failed++; lastError = err instanceof Error ? err.message : String(err) }
    onProgress(done, list.length)
  }
  return { done, failed, total: list.length, appliedUrls, appliedSlots, lastError }
}

/** Lets any nested set card jump to a creator in the Creators tab. */
export const CreatorNav = createContext<(username: string) => void>(() => {})

/** Small skeleton-aware thumbnail button used in the SetCard expanded view. */
export function ThumbButton({ url, label, episode, onClick, selectable, selected, onSelect, pageUrl, site }: {
  url: string
  label: string
  episode?: number
  onClick: () => void
  /** The poster competes with others in the set for one Plex slot, so it carries a pick control. */
  selectable?: boolean
  /** This is the poster that will be applied. */
  selected?: boolean
  onSelect?: () => void
  /** Where the poster can be viewed on its site; shows an open link on hover. */
  pageUrl?: string
  /** The site's display name, for the link's label. */
  site?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const thumb = (
    <button
      className={`${styles.groupThumb} ${!loaded ? styles.skeleton : ''}`}
      title={`${episode != null ? `Episode ${episode}` : label} - click to enlarge`}
      onClick={onClick}
    >
      <img
        src={url}
        alt={label}
        loading="lazy"
        draggable={false}
        className={loaded ? '' : styles.imgPending}
        onLoad={() => setLoaded(true)}
      />
      {episode != null && <span className={styles.epBadge}>E{episode}</span>}
    </button>
  )
  const openLabel = `Open on ${site ?? 'its site'}`
  const link = pageUrl && (
    <button
      className={styles.thumbLink}
      onClick={() => window.api.app.openExternal(pageUrl)}
      title={openLabel}
      aria-label={openLabel}
    >
      <ExternalLink size={11} />
    </button>
  )
  if (!selectable) return link ? <div className={styles.groupThumbWrap}>{thumb}{link}</div> : thumb
  const pickLabel = selected ? 'This poster will be applied' : 'Apply this poster instead'
  return (
    <div className={`${styles.groupThumbWrap} ${selected ? styles.groupThumbSelected : styles.groupThumbPassed}`}>
      {thumb}
      {link}
      <button
        className={`${styles.pickBtn} ${selected ? styles.pickBtnOn : ''}`}
        onClick={onSelect}
        aria-pressed={selected}
        title={pickLabel}
        aria-label={pickLabel}
      >
        {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      </button>
    </div>
  )
}
