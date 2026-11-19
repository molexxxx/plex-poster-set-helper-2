import type { PosterSetSummary } from '../../ipc/types'

/** What the library browser can look up on ThePosterDB. */
export type PosterdbMediaType = 'movie' | 'show' | 'collection'

/** What the library browser gets back for a title. */
export interface PosterdbBrowseResult
{
  sets: PosterSetSummary[]
  /** The site lists more sets than were read. */
  capped: boolean
  /** The title's media page on the site, once resolved. */
  mediaUrl?: string
}
