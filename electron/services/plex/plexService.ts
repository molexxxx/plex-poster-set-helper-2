import { plexConnection } from './plexConnection'
import { plexSearch } from './plexSearch'
import { plexCollections } from './plexCollections'
import { plexSections } from './plexSections'
import { plexIds } from './plexIds'
import { plexArtwork } from './plexArtwork'

/** Talks to the connected Plex Media Server: lookups, poster upload/reset, and stats. */
export const PlexService = {
  ...plexConnection,
  ...plexSearch,
  ...plexCollections,
  ...plexSections,
  ...plexIds,
  ...plexArtwork,
}
