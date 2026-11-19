import { useEffect, useState } from 'react'
import type { LibraryItem, PlexArtSlot } from '../../../../../electron/ipc/types'
import { ART_CACHE_TTL, currentArtCache, staleCurrentArt } from '../setsCache'

/**
 * The item's current Plex art for the strip, shown from this window's cache
 * while fresh and read again otherwise.
 *
 * @param item - The title or collection the panel shows.
 * @returns The art slots, whether they are loading, and `bumpArtReload`, which reads them again after an apply.
 */
export function useCurrentArt(item: LibraryItem)
{
  const [artSlots, setArtSlots] = useState<PlexArtSlot[]>([])
  const [artLoading, setArtLoading] = useState(true)
  const [artReloadKey, setArtReloadKey] = useState(0)

  useEffect(() =>
  {
    let cancelled = false
    const cacheKey = item.key
    const cached = currentArtCache.get(cacheKey)
    const fresh = !!cached && Date.now() - cached.fetchedAt < ART_CACHE_TTL
    const forced = artReloadKey > 0

    if (cached && !forced)
    {
      setArtSlots(cached.slots)
      setArtLoading(false)
    }
    else if (!cached)
    {
      setArtSlots([])
      setArtLoading(true)
    }

    if (fresh && !forced) return

    window.api.library.currentArt({
      key: item.key,
      type: item.type === 'collection' ? 'collection' : item.type === 'show' ? 'show' : 'movie',
      title: item.title,
      year: item.year,
    }).then(res =>
    {
      if (cancelled) return
      currentArtCache.set(cacheKey, { slots: res.slots, fetchedAt: Date.now() })
      setArtSlots(res.slots)
    }).catch(() =>
    {
      if (!cancelled && !cached) setArtSlots([])
    }).finally(() =>
    {
      if (!cancelled) setArtLoading(false)
    })
    return () => { cancelled = true }
  }, [item.key, item.type, item.title, item.year, artReloadKey])

  function bumpArtReload()
  {
    staleCurrentArt(item.key)
    setArtReloadKey(k => k + 1)
  }

  return { artSlots, artLoading, bumpArtReload }
}
