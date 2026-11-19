import type { PosterGroup } from '../../../utils/posterGroups'
import type { PosterResult } from '../hooks/useScrapeStore'
import type { PosterMarks } from '../hooks/useEntryUploads'
import type { PatchPoster } from '../uploadPoster'
import PosterThumb from './PosterThumb'
import styles from './EntryPosterGroups.module.css'

interface EntryPosterGroupsProps
{
  groups: PosterGroup<PosterResult>[]
  entryId: string
  setId?: string
  patchPoster: PatchPoster
  marks: PosterMarks
  /** Opens the lightbox at a poster's place among every group's posters. */
  onView: (index: number) => void
}

/** A queue entry's posters in their groups (show, seasons, backdrops, title cards), each a grid of thumbnails. */
export default function EntryPosterGroups({ groups, entryId, setId, patchPoster, marks, onView }: EntryPosterGroupsProps)
{
  let flat = -1
  return (
    <>
      {groups.map(g =>
      {
        const wide = g.kind === 'title_card' || g.kind === 'backdrop'
        return (
          <div key={g.label} className={styles.posterGroup}>
            <div className={styles.posterGroupLabel}>
              {g.label}<span className={styles.posterGroupCount}>{g.posters.length}</span>
            </div>
            <div className={`${styles.posterGrid} ${wide ? styles.posterGridWide : ''}`}>
              {g.posters.map(p =>
              {
                flat++
                const idx = flat
                return (
                  <PosterThumb
                    key={p.url}
                    poster={p}
                    entryId={entryId}
                    patchPoster={patchPoster}
                    onView={() => onView(idx)}
                    applied={marks.applied(p)}
                    downloaded={marks.downloaded(p)}
                    inLibrary={!marks.applied(p) && !marks.downloaded(p) && marks.inLibrary(p)}
                    setId={setId}
                    wide={wide}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}
