import { useEffect, useState } from 'react'
import type { AppliedRecord, LibraryItem, PosterInfo, PosterSetSummary } from '../../../../../electron/ipc/types'
import {
  collectionName, defaultSetApplyScope, memberKey, moviesInLibrary, posterFileType, resolveVariants, setKey,
  type ApplyContext, type FileType, type SetApplyScope,
} from '../../../../utils/posterGroups'
import { appliedKey, loadAppliedIndex, recordAppliedBatch, type AppliedIndex } from '../../../../utils/appliedTracker'
import { errorMessage } from '../../../../utils/errorMessage'
import { applyError, applyPosters, type ApplyState } from '../../libraryShared'
import { matchCollectionChild } from '../setsPanelUtils'
const NO_PICKS: Record<string, Record<string, string>> = {}

interface SetApplyOptions
{
  item: LibraryItem
  types: Set<FileType>
  /** Whether each collection-member movie is in the library, by member key. */
  memberInLib: Map<string, boolean>
  /** Whether each collection exists in Plex, by collection name. */
  collectionInPlex: Map<string, boolean>
  collectionMembers: LibraryItem[]
  resolvedTmdbId?: string
  /** Shows a newly applied poster on its grid card. */
  onItemPoster: (key: string, thumb: string) => void
  /** Reads the current art again after an apply. */
  bumpArtReload: () => void
}

/**
 * Applying sets from the panel: each set's scope and poster picks, the apply
 * with its progress, and the applied-art index the badges read.
 *
 * @returns The apply state per set, the scope and pick setters, the applied
 *   index, `scopeOf`, and `applySet`.
 */
export function useSetApply({ item, types, memberInLib, collectionInPlex, collectionMembers, resolvedTmdbId, onItemPoster, bumpArtReload }: SetApplyOptions)
{
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})
  // Per-set apply scope: movies and collection poster are chosen independently.
  const [collectionScope, setCollectionScope] = useState<Record<string, SetApplyScope>>({})
  // Per-set choice of which poster fills a Plex slot that several posters in
  // the set compete for, keyed by set then slot (see variantKey). Scoped to
  // the viewed item by key, so a switch starts clean without a reset effect.
  const [pickState, setPickState] = useState<{ key: string; bySet: Record<string, Record<string, string>> }>({ key: '', bySet: {} })
  const picks = pickState.key === item.key ? pickState.bySet : NO_PICKS
  const [appliedIdx, setAppliedIdx] = useState<AppliedIndex>({ setKeys: new Set(), titles: new Set(), posterUrls: new Set(), currentByItem: new Map(), currentPosterUrls: new Set() })
  const isCollectionItem = item.type === 'collection'
  useEffect(() => { loadAppliedIndex().then(setAppliedIdx) }, [])

  // True when a collection-member poster targets the currently viewed item
  // (exact TMDB match preferred; title/year as a fallback when ids are absent).
  function isThisItem(p: PosterInfo): boolean {
    const myTmdb = item.tmdbId ?? resolvedTmdbId
    if (p.tmdbId && myTmdb) return p.tmdbId === myTmdb
    return p.title.toLowerCase().trim() === item.title.toLowerCase().trim()
      && (p.year == null || item.year == null || p.year === item.year)
  }

  /** Main poster (no season/episode) of a list, for the grid thumbnail. */
  function mainThumb(posters: PosterInfo[]): string | undefined {
    const main = posters.find(p => p.season == null && p.episode == null)
    return main ? (main.thumbUrl ?? main.url) : undefined
  }

  /**
   * What a set can apply from this view, shared by its card and its apply so
   * the controls always describe what Apply will do.
   *
   * @param s - The set.
   * @returns The movie counts, the collection-art state, and the scope in effect.
   */
  function scopeOf(s: PosterSetSummary) {
    const context: ApplyContext = isCollectionItem ? 'collection' : 'title'
    const moviesInLib = moviesInLibrary(s.posters, context, isThisItem, k => !!memberInLib.get(k))
    const moviesTotal = moviesInLibrary(s.posters, context, isThisItem, () => true)
    // From a Plex Collection, a set that tags neither collection art nor
    // member posters has its plain posters applied as the collection's art.
    const hasCollectionArt = s.posters.some(p => p.isCollection)
      || (isCollectionItem
          && !s.posters.some(p => p.isCollectionMember)
          && s.posters.some(p => !p.isCollection))
    const collNames = isCollectionItem ? [] : [...new Set(s.posters.filter(p => p.isCollection).map(p => collectionName(p.title)))]
    const collectionMissing = collNames.length > 0 && collNames.every(n => collectionInPlex.get(n) === false)
    const defaultScope = defaultSetApplyScope(hasCollectionArt && !collectionMissing, moviesInLib)
    const picked = collectionScope[setKey(s)] ?? defaultScope
    return {
      moviesInLib,
      moviesTotal,
      hasCollectionArt,
      collectionMissing,
      defaultScope,
      scope: collectionMissing ? { ...picked, collectionPoster: false } : picked,
      showScope: hasCollectionArt || moviesInLib > 1 || (isCollectionItem && moviesInLib > 0),
    }
  }

  async function applySet(s: PosterSetSummary) {
    // Every per-set map is keyed by source, never by the raw id (see setKey).
    const sKey = setKey(s)
    const { scope, showScope } = scopeOf(s)

    const collectionArt = s.posters.filter(p => p.isCollection)
    const members       = s.posters.filter(p => p.isCollectionMember)
    const plain         = s.posters.filter(p => !p.isCollection && !p.isCollectionMember)

    // When browsing from a Plex Collection and the set carries no explicitly-tagged
    // collection art or per-movie member posters, treat plain (unclassified) posters
    // as the collection-level art — they have nowhere else to go from this view.
    const effectiveCollArt = isCollectionItem && collectionArt.length === 0 && members.length === 0
      ? plain
      : collectionArt
    const chosen = picks[sKey] ?? {}

    if (isCollectionItem) {
      // One poster per Plex slot (see resolveVariants): a set carrying art for
      // several collections would otherwise upload them all to this one and
      // keep whichever came last.
      const memberPosters = resolveVariants(
        scope.movies === 'none' ? [] : members.filter(p => memberInLib.get(memberKey(p))),
        'collection', chosen,
      )
      const collArt = scope.collectionPoster ? resolveVariants(effectiveCollArt, 'collection', chosen, item.title) : []

      const willApply = [...memberPosters, ...collArt]
      const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
      if (enabledTotal === 0) return
      setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: 0, total: enabledTotal } }))

      let totalDone = 0, totalFailed = 0
      const records: AppliedRecord[] = []
      const bump = (d: number) =>
        setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

      if (memberPosters.length > 0) {
        const movieMap = new Map<string, { child: LibraryItem; posters: PosterInfo[] }>()
        for (const p of memberPosters) {
          const child = matchCollectionChild(p, collectionMembers)
          if (!child) continue
          const existing = movieMap.get(child.key)
          if (existing) existing.posters.push(p)
          else movieMap.set(child.key, { child, posters: [p] })
        }
        for (const { child, posters } of movieMap.values()) {
          const memberRes = await applyPosters(child.key, posters, types, bump)
          totalDone += memberRes.done; totalFailed += memberRes.failed
          if (memberRes.done > 0) {
            const thumb = mainThumb(posters)
            records.push({
              itemKey: child.key, title: child.title, year: child.year, type: 'movie',
              source: s.source, thumb: thumb ?? child.thumb, setId: s.id, uploader: s.uploader,
              posterUrls: memberRes.appliedUrls, slots: memberRes.appliedSlots, appliedAt: new Date().toISOString(),
            })
            if (thumb) onItemPoster(child.key, thumb)
          }
        }
      }

      if (collArt.length) {
        const collRes = await applyPosters(item.key, collArt, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          const thumb = mainThumb(collArt) ?? item.thumb
          records.push({
            itemKey: item.key, title: item.title, type: 'collection',
            source: s.source, thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, slots: collRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(item.key, thumb)
        }
      }

      let historyError: string | undefined
      if (records.length > 0) {
        historyError = await recordAppliedBatch(records).then(() => undefined, (err: unknown) => errorMessage(err))
        const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
        setAppliedIdx(prev => ({
          setKeys: new Set(prev.setKeys).add(sKey),
          titles: prev.titles,
          posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
          currentByItem: records.reduce((map, r) => map.set(r.itemKey, sKey), new Map(prev.currentByItem)),
          currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
        }))
        bumpArtReload()
      }
      setApplyMap(m => ({
        ...m,
        [sKey]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
      }))
      return
    }

    // A plain movie/show set has no collection dimension, so the scope toggle is
    // never shown for it (see `showScope`); its posters must always apply. Only
    // suppress the viewed item's own art when the scope control is actually
    // present and the user set it to "none".
    // One poster per Plex slot (see resolveVariants): two posters for the same
    // slot would otherwise both upload, and the last would win.
    const viewedPosters = resolveVariants(
      showScope && scope.movies === 'none' ? [] : [...plain, ...members.filter(isThisItem)],
      'title', chosen,
    )
    const siblingMembers = resolveVariants(
      scope.movies === 'all' ? members.filter(p => !isThisItem(p) && memberInLib.get(memberKey(p))) : [],
      'title', chosen,
    )
    const collArt = scope.collectionPoster ? resolveVariants(collectionArt, 'title', chosen) : []

    const willApply = [...viewedPosters, ...siblingMembers, ...collArt]
    const enabledTotal = willApply.filter(p => types.has(posterFileType(p))).length
    if (enabledTotal === 0) return
    setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const skipped: string[] = []
    const records: AppliedRecord[] = []
    const bump = (d: number) =>
      setApplyMap(m => ({ ...m, [sKey]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

    // 1. The viewed item's own art.
    const mainRes = await applyPosters(item.key, viewedPosters, types, bump)
    totalDone += mainRes.done; totalFailed += mainRes.failed
    if (mainRes.done > 0) {
      const thumb = mainThumb(viewedPosters)
      records.push({
        itemKey: item.key, title: item.title, year: item.year, type: item.type,
        source: s.source, thumb: thumb ?? item.thumb, setId: s.id, uploader: s.uploader,
        posterUrls: mainRes.appliedUrls, slots: mainRes.appliedSlots, appliedAt: new Date().toISOString(),
      })
      if (thumb) onItemPoster(item.key, thumb)
    }

    // 2. Sibling movies in the collection: resolve each to its own Plex key.
    if (siblingMembers.length > 0) {
      const movieMap = new Map<string, { title: string; year?: number; tmdbId?: string; posters: PosterInfo[] }>()
      for (const p of siblingMembers) {
        const key = memberKey(p)
        const existing = movieMap.get(key)
        if (existing) existing.posters.push(p)
        else movieMap.set(key, { title: p.title, year: p.year, tmdbId: p.tmdbId, posters: [p] })
      }
      for (const m of movieMap.values()) {
        const found = await window.api.plex.findItem(m.title, m.year, undefined, m.tmdbId) as { key: string; title: string; year?: number; type: string; thumb?: string; libraryTitle?: string } | null
        // Not in the library - skip quietly rather than reporting a failure.
        if (!found) continue
        const memberRes = await applyPosters(found.key, m.posters, types, bump)
        totalDone += memberRes.done; totalFailed += memberRes.failed
        if (memberRes.done > 0) {
          const thumb = mainThumb(m.posters)
          records.push({
            itemKey: found.key, title: found.title, year: found.year,
            type: (found.type === 'movie' ? 'movie' : 'show'),
            source: s.source, thumb: thumb ?? found.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: memberRes.appliedUrls, slots: memberRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
          if (thumb) onItemPoster(found.key, thumb)
        }
      }
    }

    // 3. Collection-level art onto the matching Plex Collection objects. A set
    //    can carry art for several collections (a franchise and its spin-off);
    //    each is matched by its own name.
    if (collArt.length) {
      const byCollection = new Map<string, PosterInfo[]>()
      for (const p of collArt) {
        const name = collectionName(p.title)
        const list = byCollection.get(name)
        if (list) list.push(p)
        else byCollection.set(name, [p])
      }
      for (const posters of byCollection.values()) {
        const coll = await window.api.plex.findCollection(posters[0].title) as { key: string; title: string; thumb?: string; libraryTitle?: string } | null
        if (!coll) {
          skipped.push(`no Plex collection matches "${posters[0].title}"`)
          continue
        }
        const collRes = await applyPosters(coll.key, posters, types, bump)
        totalDone += collRes.done; totalFailed += collRes.failed
        if (collRes.done > 0) {
          records.push({
            itemKey: coll.key, title: coll.title, type: 'collection',
            source: s.source, thumb: mainThumb(posters) ?? coll.thumb, setId: s.id, uploader: s.uploader,
            posterUrls: collRes.appliedUrls, slots: collRes.appliedSlots, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    // One atomic write so every touched item keeps its Reset Posters row.
    let historyError: string | undefined
    if (records.length > 0) {
      historyError = await recordAppliedBatch(records).then(() => undefined, (err: unknown) => errorMessage(err))
      const appliedUrls = records.flatMap(r => r.posterUrls ?? [])
      setAppliedIdx(prev => ({
        setKeys: new Set(prev.setKeys).add(sKey),
        titles: new Set([...prev.titles, ...records.map(r => appliedKey(r.title, r.year))]),
        posterUrls: new Set([...prev.posterUrls, ...appliedUrls]),
        currentByItem: records.reduce((map, r) => map.set(r.itemKey, sKey), new Map(prev.currentByItem)),
        currentPosterUrls: new Set([...prev.currentPosterUrls, ...appliedUrls]),
      }))
      bumpArtReload()
    }
    setApplyMap(m => ({
      ...m,
      [sKey]: {
        status: !totalDone && (totalFailed || skipped.length) ? 'error' : 'done',
        done: totalDone, total: enabledTotal,
        error: applyError(totalFailed, historyError, skipped),
      },
    }))
  }

  return { applyMap, setApplyMap, setCollectionScope, picks, setPickState, appliedIdx, scopeOf, applySet }
}
