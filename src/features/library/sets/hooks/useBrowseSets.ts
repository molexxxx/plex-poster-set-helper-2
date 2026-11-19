import { useEffect, useState } from 'react'
import type { BrowseSetsRes, LibraryItem, PosterSetSummary, SetSource } from '../../../../../electron/ipc/types'
import { byPopularity } from '../../../../utils/librarySets'
import { errorMessage } from '../../../../utils/errorMessage'
import { BROWSE_CACHE_TTL, browseCacheKey, browseSetsCache } from '../setsCache'
import { SOURCES, sourceFailure } from '../setsPanelUtils'

/**
 * The sets MediUX and ThePosterDB offer for an item. Each site is asked on
 * its own and merged as it answers; a cached answer shows at once and is read
 * again in the background once stale.
 *
 * @param item - The title or collection the panel shows.
 * @returns The sets, the loading and refresh state, each site's failure and
 *   notices, the TMDB id MediUX resolved, the collection's members, and `refreshSets`.
 */
export function useBrowseSets(item: LibraryItem)
{
  const [sets, setSets]       = useState<PosterSetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  // The item has no TMDB id, so only ThePosterDB could be searched.
  const [tmdbMissing, setTmdbMissing] = useState(false)
  // A site that was asked but could not answer, shown beside the other's sets.
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<SetSource, string>>>({})
  // Sites still being searched once the first answer is in.
  const [pending, setPending] = useState<Set<SetSource>>(new Set())
  // ThePosterDB lists more sets than the panel read; the page to continue on.
  const [posterdbMore, setPosterdbMore] = useState<string | null>(null)
  // TMDB id MediUX resolved for this item (set even when the Plex item uses a
  // tvdb/imdb agent), used to match the viewed item's collection-member poster.
  const [resolvedTmdbId, setResolvedTmdbId] = useState<string | undefined>(undefined)
  const [setsReloadKey, setSetsReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [collectionMembers, setCollectionMembers] = useState<LibraryItem[]>([])
  const isCollectionItem = item.type === 'collection'
  useEffect(() => {
    let cancelled = false
    const key = browseCacheKey(item)
    const cached = browseSetsCache.get(key)
    const forced = setsReloadKey > 0
    const fresh = !!cached && Date.now() - cached.fetchedAt < BROWSE_CACHE_TTL

    setError(null)
    setPending(new Set())

    if (cached) {
      setSets(cached.sets)
      setResolvedTmdbId(cached.tmdbId)
      setTmdbMissing(!!cached.tmdbMissing)
      setCollectionMembers(cached.collectionMembers ?? [])
      setSourceErrors(cached.sourceErrors ?? {})
      setPosterdbMore(cached.posterdbUrl ?? null)
      setLoading(false)
    } else {
      setSets([])
      setCollectionMembers([])
      setSourceErrors({})
      setPosterdbMore(null)
      setLoading(true)
    }

    if (fresh && !forced) return

    const hasCache = !!cached
    if (hasCache) setRefreshing(true)
    setPending(new Set(SOURCES))

    // Each site is asked on its own, so MediUX's single page is not held back
    // by the ThePosterDB walk; answers merge into the list as they arrive.
    const request = (sources: SetSource[]): Promise<BrowseSetsRes> => isCollectionItem
      ? window.api.library.collectionSets({ collectionKey: item.key, title: item.title, sources, fresh: forced })
      : window.api.library.sets({
          type: item.type === 'show' ? 'show' : 'movie',
          tmdbId: item.tmdbId, tvdbId: item.tvdbId, imdbId: item.imdbId, anidbId: item.anidbId,
          // ThePosterDB has no id lookup, so it matches on these.
          title: item.title, year: item.year,
          sources, fresh: forced,
        })

    // Most downloaded first (byPopularity); followed/hidden ordering is applied
    // live in visibleSets, so it follows a follow or hide without a reload.
    const results: Partial<Record<SetSource, BrowseSetsRes>> = {}

    const settle = (src: SetSource, res: BrowseSetsRes) => {
      if (cancelled) return
      results[src] = res
      setSourceErrors(prev => ({ ...prev, [src]: sourceFailure(src, res) }))
      setSets(prev => [...prev.filter(s => s.source !== src), ...res.sets].sort(byPopularity))
      if (res.collectionMembers) setCollectionMembers(res.collectionMembers)
      if (src === 'mediux') {
        setResolvedTmdbId(res.tmdbId)
        setTmdbMissing(!!res.tmdbMissing)
      } else {
        setPosterdbMore(res.posterdbCapped && res.posterdbUrl ? res.posterdbUrl : null)
      }
      if (res.error === 'no_movies') setError('no_movies')
      setPending(prev => { const next = new Set(prev); next.delete(src); return next })
      setLoading(false)
    }

    Promise.all(SOURCES.map(src =>
      request([src]).then(res => settle(src, res), (e: unknown) => settle(src, { sets: [], error: errorMessage(e) })),
    )).then(() => {
      if (cancelled) return
      const m = results.mediux, p = results.posterdb
      const failures: Partial<Record<SetSource, string>> = {}
      for (const src of SOURCES) {
        const f = results[src] && sourceFailure(src, results[src])
        if (f) failures[src] = f
      }
      // "No TMDB id" blocks the panel only when ThePosterDB had nothing to add.
      if (m?.tmdbMissing && !p?.sets.length && !failures.posterdb && !m.error) setError('no_tmdb')
      // A site that failed is retried on the next open rather than remembered.
      if (!Object.keys(failures).length) {
        browseSetsCache.set(key, {
          sets: [...(m?.sets ?? []), ...(p?.sets ?? [])].sort(byPopularity),
          tmdbId: m?.tmdbId,
          tmdbMissing: m?.tmdbMissing,
          collectionMembers: m?.collectionMembers ?? p?.collectionMembers,
          posterdbUrl: p?.posterdbCapped && p.posterdbUrl ? p.posterdbUrl : undefined,
          fetchedAt: Date.now(),
        })
      }
      setLoading(false)
      setRefreshing(false)
    })
    return () => { cancelled = true }
  }, [item.key, item.type, item.title, item.year, item.tmdbId, item.tvdbId, item.imdbId, item.anidbId, isCollectionItem, setsReloadKey])

  function refreshSets() {
    browseSetsCache.delete(browseCacheKey(item))
    setSetsReloadKey(k => k + 1)
  }

  return { sets, loading, error, tmdbMissing, sourceErrors, pending, posterdbMore, resolvedTmdbId, collectionMembers, refreshing, setsReloadKey, refreshSets }
}

/** The browse state and actions `useBrowseSets` returns. */
export type BrowseSets = ReturnType<typeof useBrowseSets>
