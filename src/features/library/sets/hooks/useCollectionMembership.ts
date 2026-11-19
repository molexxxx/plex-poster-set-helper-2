import { useEffect, useState } from 'react'
import type { LibraryItem, PosterSetSummary } from '../../../../../electron/ipc/types'
import { collectionName, memberKey } from '../../../../utils/posterGroups'
import { matchCollectionChild } from '../setsPanelUtils'

/**
 * Which collection-member movies and collection posters in the sets have
 * something in Plex to land on, resolved the way an apply resolves them.
 *
 * @param item - The title or collection the panel shows.
 * @param allSets - Every set the panel lists.
 * @param resolvedTmdbId - The TMDB id MediUX resolved for the item.
 * @param collectionMembers - The collection's movies, for a collection view.
 * @returns Whether each member movie is in the library, and whether each collection exists in Plex.
 */
export function useCollectionMembership(item: LibraryItem, allSets: PosterSetSummary[], resolvedTmdbId: string | undefined, collectionMembers: LibraryItem[])
{
  // Which collection-member movies actually exist in the Plex library, keyed by
  // tmdbId (or title|year). Resolved with the same findItem the apply uses, so
  // the "N movies" count matches exactly what "apply all" will touch.
  const [memberInLib, setMemberInLib] = useState<Map<string, boolean>>(new Map())
  // Whether a Plex Collection exists for each collection poster's name.
  const [collectionInPlex, setCollectionInPlex] = useState<Map<string, boolean>>(new Map())
  const isCollectionItem = item.type === 'collection'
  // Resolve which collection-member movies are in scope for apply toggles.
  useEffect(() =>
  {
    const unique = new Map<string, { title: string; year?: number; tmdbId?: string }>()
    for (const s of allSets) for (const p of s.posters)
    {
      if (!p.isCollectionMember) continue
      const k = memberKey(p)
      if (!unique.has(k)) unique.set(k, { title: p.title, year: p.year, tmdbId: p.tmdbId })
    }
    if (unique.size === 0) { setMemberInLib(new Map()); return }

    if (isCollectionItem)
    {
      const out = new Map<string, boolean>()
      for (const [k, m] of unique)
      {
        out.set(k, !!matchCollectionChild(
          { title: m.title, year: m.year, tmdbId: m.tmdbId, url: '', source: 'mediux' },
          collectionMembers,
        ))
      }
      setMemberInLib(out)
      return
    }

    const myTmdb = item.tmdbId ?? resolvedTmdbId
    let cancelled = false
    ;(async () =>
    {
      const out = new Map<string, boolean>()
      for (const [k, m] of unique)
      {
        if (m.tmdbId && myTmdb && m.tmdbId === myTmdb) { out.set(k, true); continue }
        const found = await window.api.plex.findItem(m.title, m.year, undefined, m.tmdbId)
        if (cancelled) return
        out.set(k, !!found)
      }
      if (!cancelled) setMemberInLib(out)
    })()
    return () => { cancelled = true }
  }, [allSets, item.tmdbId, resolvedTmdbId, isCollectionItem, collectionMembers])

  // Which collection posters have a Plex Collection to land on from a title
  // view, keyed by collectionName and resolved with the same findCollection
  // the apply uses. A name not resolved yet counts as present; a collection
  // view never reads the map, since its target is the viewed collection.
  useEffect(() =>
  {
    if (isCollectionItem) return
    const names = new Map<string, string>()
    for (const s of allSets) for (const p of s.posters)
    {
      if (p.isCollection && !names.has(collectionName(p.title))) names.set(collectionName(p.title), p.title)
    }
    if (names.size === 0) return
    let cancelled = false
    ;(async () =>
    {
      const out = new Map<string, boolean>()
      for (const [name, title] of names)
      {
        const found = await window.api.plex.findCollection(title).catch(() => null)
        if (cancelled) return
        out.set(name, !!found)
      }
      if (!cancelled) setCollectionInPlex(out)
    })()
    return () => { cancelled = true }
  }, [allSets, isCollectionItem])

  return { memberInLib, collectionInPlex }
}
