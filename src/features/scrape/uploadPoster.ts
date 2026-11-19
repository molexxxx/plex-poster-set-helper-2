import { recordAppliedQuietly } from '../../utils/appliedTracker'
import { posterSlot } from '../../../electron/services/schedule/appliedArt'
import type { PosterResult } from './hooks/useScrapeStore'

/** Store mutator for one poster's upload status. */
export type PatchPoster = (entryId: string, posterUrl: string, patch: Partial<PosterResult>) => void

/**
 * Matches a poster to its Plex target (item or collection) and uploads it via
 * IPC, patching the poster's upload status as it goes.
 *
 * @param entryId - Owning queue entry.
 * @param poster - Poster to upload.
 * @param patchPoster - Store mutator for per-poster status updates.
 * @param setId - MediUX set id recorded into the applied history.
 */
export async function uploadPoster(
  entryId: string,
  poster: PosterResult,
  patchPoster: PatchPoster,
  setId?: string,
) {
  patchPoster(entryId, poster.url, { uploadStatus: 'matching' })
  try {
    // Collection art (e.g. a boxset's "Toy Story Collection" set) applies to a
    // Plex Collection object, matched by name - not an individual movie/show.
    if (poster.isCollection) {
      const coll = await window.api.plex.findCollection(poster.title)
      if (!coll) {
        patchPoster(entryId, poster.url, { uploadStatus: 'no_match' })
        return
      }
      patchPoster(entryId, poster.url, { uploadStatus: 'uploading' })
      const res = await window.api.plex.uploadPoster(coll.key, poster.url, poster.source, poster.season, poster.episode, true, coll.title)
      if (res.success) {
        void recordAppliedQuietly({
          itemKey: coll.key,
          title: coll.title,
          type: 'collection',
          source: poster.source,
          libraryTitle: coll.libraryTitle,
          thumb: poster.thumbUrl ?? poster.url,
          setId,
          posterUrls: [poster.url],
          slots: [posterSlot(poster)],
          appliedAt: new Date().toISOString(),
        })
      }
      patchPoster(entryId, poster.url, {
        uploadStatus: res.success ? 'done' : 'error',
        uploadError: res.success ? undefined : res.error,
      })
      return
    }

    // Match by TMDB id when the poster carries one (same as the Library Browser),
    // falling back to title/year inside findItem when it doesn't.
    const item = await window.api.plex.findItem(poster.title, poster.year, undefined, poster.tmdbId)
    if (!item) {
      patchPoster(entryId, poster.url, { uploadStatus: 'no_match' })
      return
    }
    patchPoster(entryId, poster.url, { uploadStatus: 'uploading' })
    const res = await window.api.plex.uploadPoster(item.key, poster.url, poster.source, poster.season, poster.episode, undefined, item.title)
    if (res.success) {
      // Track it so it appears in Reset Posters and the "in library" marker.
      // Recording the setId keeps it interchangeable with the Library Browser.
      void recordAppliedQuietly({
        itemKey: item.key,
        title: item.title,
        year: item.year,
        type: item.type === 'movie' ? 'movie' : 'show',
        source: poster.source,
        libraryTitle: item.libraryTitle,
        thumb: poster.thumbUrl ?? poster.url,
        setId,
        posterUrls: [poster.url],
        slots: [posterSlot(poster)],
        appliedAt: new Date().toISOString(),
      })
    }
    patchPoster(entryId, poster.url, {
      uploadStatus: res.success ? 'done' : 'error',
      uploadError: res.success ? undefined : res.error,
    })
  } catch (err) {
    patchPoster(entryId, poster.url, {
      uploadStatus: 'error',
      uploadError: err instanceof Error ? err.message : String(err),
    })
  }
}
