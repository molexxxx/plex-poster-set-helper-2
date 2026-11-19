interface SeasonEntry { id?: string | number; season_number?: number }

interface Show {
  id?: string | number
  name?: string
  title?: string
  first_air_date?: string
  seasons?: SeasonEntry[]
}

interface Movie {
  id?: string | number
  title?: string
  release_date?: string
}

interface Collection {
  id?: string | number
  collection_name?: string
  movies?: Movie[]
}

interface SeasonRef  { id?: string | number; season_number?: number }
interface EpisodeRef { id?: string | number; episode_number?: number; season_id?: SeasonRef }
interface ShowRef    { id?: string | number; name?: string; title?: string }
interface MovieRef   { id?: string | number; title?: string; release_date?: string }

/** One artwork file in a set, as MediUX's page data lists it. */
export interface MediuxFile {
  id: string
  fileType: string
  title?: string | null
  show_id?:       ShowRef | null
  season_id?:     SeasonRef | null
  episode_id?:    EpisodeRef | null
  movie_id?:      MovieRef | null
  collection_id?: { id?: string | number; collection_name?: string } | null
  downloads_func?: { count?: number | string } | null
}

/** The creator a set belongs to. */
export interface UserCreated {
  username?: string
  avatar?: string | { id?: string } | null
}

/** A set as MediUX's page data carries it. */
export interface MediuxSet {
  id: number | string
  name?: string
  set_name?: string
  date_updated?: string
  user_created?: UserCreated | null
  show?:       Show | null
  movie?:      Movie | null
  collection?: Collection | null
  files?:      MediuxFile[]
}

/**
 * Fallback metadata for pages (shows/boxsets) that don't denormalise show/movie
 * info into each set - derived from the page's og:title ("Name (Year)").
 */
export interface Fallback { title?: string; year?: number }
