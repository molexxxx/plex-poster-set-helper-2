import { useEffect, useMemo, useState } from 'react'
import type { LightboxImage } from '../../../components/ui/Lightbox'
import { filterByTypes, groupPosters, type FileType } from '../../../utils/posterGroups'
import { appliedKey, loadAppliedIndex, type AppliedIndex } from '../../../utils/appliedTracker'
import { setRefOfUrl } from '../../../../electron/services/schedule/coverage'
import { uploadPoster, type PatchPoster } from '../uploadPoster'
import type { PosterResult, QueueEntry } from './useScrapeStore'

/** How each poster stands against what is applied in the library. */
export interface PosterMarks {
  applied: (p: PosterResult) => boolean
  downloaded: (p: PosterResult) => boolean
  inLibrary: (p: PosterResult) => boolean
}

/**
 * The posters a queue entry shows for the picked artwork types, how each
 * stands against the library, and the uploads its row buttons run.
 *
 * @param entry - The queue entry.
 * @param types - Artwork types shown and uploaded.
 * @param patchPoster - Store mutator for per-poster status updates.
 * @param expanded - Whether the poster grid is open; the applied history is read while it is.
 * @returns The shown posters and their groups, the row's counts, lightbox
 *   images, each poster's marks, and `uploadAll` / `uploadUnapplied`.
 */
export function useEntryUploads(entry: QueueEntry, types: Set<FileType>, patchPoster: PatchPoster, expanded: boolean) {
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })

  const { shown, hidden: hiddenCount } = useMemo(() => filterByTypes(entry.posters, types), [entry.posters, types])
  const doneCount = shown.filter(p => p.uploadStatus === 'done').length

  // Set id for this entry, recorded on upload so the Library Browser
  // recognizes it; the scheduler reads it from the same helper.
  const entrySetId = setRefOfUrl(entry.url)?.id

  // Reloads when expanded and whenever an upload completes so it stays live.
  useEffect(() => {
    if (!expanded) return
    loadAppliedIndex().then(setAppliedIdx)
  }, [expanded, doneCount])

  // Grouped sections + a flat list (group order) for the lightbox
  const groups = useMemo(() => groupPosters(shown), [shown])
  const lightboxImages = useMemo<LightboxImage[]>(
    () => groups.flatMap(g => g.posters.map(p => ({
      url: p.url,
      label: g.label,
      caption: p.episode != null ? `Episode ${p.episode}` : (p.title || undefined),
    }))),
    [groups],
  )
  // "Applied" = this exact poster is the one currently live in Plex.
  // "Downloaded" = uploaded before but since overwritten by a newer poster.
  const posterApplied    = (p: PosterResult) => appliedIdx.currentPosterUrls.has(p.url)
  const posterDownloaded = (p: PosterResult) => !posterApplied(p) && appliedIdx.posterUrls.has(p.url)
  const inLibraryTitle   = (p: PosterResult) => appliedIdx.titles.has(appliedKey(p.title, p.year))

  const posterCount = shown.length
  const errorCount  = shown.filter(p =>
    p.uploadStatus === 'error' || p.uploadStatus === 'no_match'
  ).length

  const hasDone    = doneCount > 0
  const hasErrors  = errorCount > 0
  const allDone    = posterCount > 0 && doneCount === posterCount

  // Posters never applied yet (new title cards, changed art, etc.)
  const unappliedCount = shown.filter(p => p.uploadStatus !== 'done' && !appliedIdx.posterUrls.has(p.url)).length

  async function uploadAll() {
    for (const p of shown) {
      if (p.uploadStatus === 'idle' || p.uploadStatus === 'no_match' || p.uploadStatus === 'error') {
        await uploadPoster(entry.id, p, patchPoster, entrySetId)
      }
    }
  }

  async function uploadUnapplied() {
    for (const p of shown) {
      if (p.uploadStatus !== 'done' && !appliedIdx.posterUrls.has(p.url)) {
        await uploadPoster(entry.id, p, patchPoster, entrySetId)
      }
    }
  }

  const marks: PosterMarks = { applied: posterApplied, downloaded: posterDownloaded, inLibrary: inLibraryTitle }
  return {
    shown, hiddenCount, doneCount, entrySetId, groups, lightboxImages, marks,
    posterCount, errorCount, hasDone, hasErrors, allDone, unappliedCount, uploadAll, uploadUnapplied,
  }
}
