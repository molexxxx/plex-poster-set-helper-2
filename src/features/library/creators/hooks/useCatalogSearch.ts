import { useEffect, useState } from 'react'
import type { MediuxUserSet } from '../../../../../electron/ipc/types'

/**
 * Searches a creator's full catalog on MediUX, debounced, while the catalog
 * here is capped or still being read.
 *
 * @param username - The creator.
 * @param partial - The catalog is capped or still being read.
 * @param q - The trimmed, lowercased query; searching starts at two characters.
 * @returns The sets found and whether a search is running, with their setters.
 */
export function useCatalogSearch(username: string, partial: boolean, q: string)
{
  const [searchResults, setSearchResults] = useState<MediuxUserSet[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() =>
  {
    if (!partial || q.length < 2) return
    let cancelled = false
    const t = setTimeout(() =>
    {
      setSearching(true)
      window.api.library.creatorSearch({ username, query: q })
        .then(res => { if (!cancelled) setSearchResults(res.sets) })
        .catch(() => { if (!cancelled) setSearchResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 550)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, partial, username])

  return { searchResults, setSearchResults, searching, setSearching }
}
