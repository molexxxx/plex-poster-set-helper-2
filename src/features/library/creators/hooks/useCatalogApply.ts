import { useState } from 'react'
import type { MediuxUserSet, PosterInfo } from '../../../../../electron/ipc/types'
import { collectionName, posterFileType, resolveVariants, setKey, singleFileTypes, type FileType } from '../../../../utils/posterGroups'
import { recordApplied, recordAppliedQuietly } from '../../../../utils/appliedTracker'
import { errorMessage } from '../../../../utils/errorMessage'
import { applyError, applyPosters, type ApplyState } from '../../libraryShared'

/**
 * Applies a whole set, or a single file, from a creator's catalog to Plex and
 * records it, keeping each apply's progress by set id or file.
 *
 * @param allTypes - The artwork types a whole set's apply uses.
 * @param onApplied - Updates the applied index once art reaches a matched title.
 * @returns The apply state per set or file, `applySet`, and `applySingle`.
 */
export function useCatalogApply(allTypes: Set<FileType>, onApplied: (sKey: string, itemKey: string, title: string, year: number | undefined, urls: string[]) => void)
{
  const [applyMap, setApplyMap] = useState<Record<string, ApplyState>>({})

  async function applySet(s: MediuxUserSet) {
    if (!s.matchedKey && !s.posters.some(p => p.isCollection)) return
    const collectionArt = resolveVariants(s.posters.filter(p => p.isCollection), 'title')
    const mainPosters   = resolveVariants(s.posters.filter(p => !p.isCollectionMember && !p.isCollection), 'title')
    const memberPosters = resolveVariants(s.posters.filter(p => p.isCollectionMember), 'title')
    const enabledTotal  = [...collectionArt, ...mainPosters, ...memberPosters].filter(p => allTypes.has(posterFileType(p))).length
    setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: 0, total: enabledTotal } }))

    let totalDone = 0, totalFailed = 0
    const allAppliedUrls: string[] = []
    const allAppliedSlots: string[] = []
    const progress = (d: number) => setApplyMap(m => ({ ...m, [s.id]: { status: 'applying', done: totalDone + d, total: enabledTotal } }))

    if (s.matchedKey) {
      const res = await applyPosters(s.matchedKey, mainPosters, allTypes, progress)
      totalDone += res.done
      totalFailed += res.failed
      allAppliedUrls.push(...res.appliedUrls)
      allAppliedSlots.push(...res.appliedSlots)
    } else if (mainPosters.length > 0) {
      totalFailed += mainPosters.filter(p => allTypes.has(posterFileType(p))).length
    }

    const byCollection = new Map<string, PosterInfo[]>()
    for (const p of collectionArt) {
      const name = collectionName(p.title)
      const list = byCollection.get(name)
      if (list) list.push(p)
      else byCollection.set(name, [p])
    }
    for (const posters of byCollection.values()) {
      const coll = await window.api.plex.findCollection(posters[0].title) as { key: string; title: string } | null
      if (!coll) {
        totalFailed += posters.filter(p => allTypes.has(posterFileType(p))).length
        continue
      }
      const res = await applyPosters(coll.key, posters, allTypes, progress)
      totalDone += res.done
      totalFailed += res.failed
      allAppliedUrls.push(...res.appliedUrls)
      allAppliedSlots.push(...res.appliedSlots)
      if (res.done > 0) {
        void recordAppliedQuietly({
          itemKey: coll.key, title: coll.title, type: 'collection', source: 'mediux', thumb: posters[0].thumbUrl ?? posters[0].url,
          setId: s.id, uploader: s.uploader, posterUrls: res.appliedUrls, slots: res.appliedSlots, appliedAt: new Date().toISOString(),
        })
      }
    }

    if (memberPosters.length > 0) {
      const movies = new Map<string, { title: string; year?: number; posters: PosterInfo[] }>()
      for (const p of memberPosters) {
        const k = `${p.title.toLowerCase()}|${p.year ?? ''}`
        const found = movies.get(k)
        if (found) found.posters.push(p)
        else movies.set(k, { title: p.title, year: p.year, posters: [p] })
      }
      for (const m of movies.values()) {
        const found = await window.api.plex.findItem(m.title, m.year) as { key: string; title: string; year?: number; type: string; thumb?: string } | null
        if (!found) {
          totalFailed += m.posters.filter(p => allTypes.has(posterFileType(p))).length
          continue
        }
        const res = await applyPosters(found.key, m.posters, allTypes, progress)
        totalDone += res.done
        totalFailed += res.failed
        allAppliedUrls.push(...res.appliedUrls)
        allAppliedSlots.push(...res.appliedSlots)
        if (res.done > 0) {
          void recordAppliedQuietly({
            itemKey: found.key, title: found.title, year: found.year, type: found.type === 'movie' ? 'movie' : 'show', source: 'mediux',
            thumb: found.thumb, setId: s.id, uploader: s.uploader, posterUrls: res.appliedUrls, slots: res.appliedSlots, appliedAt: new Date().toISOString(),
          })
        }
      }
    }

    let historyError: string | undefined
    if (totalDone > 0 && s.matchedKey) {
      historyError = await recordApplied({
        itemKey: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie', source: 'mediux', thumb: s.previewUrl,
        setId: s.id, uploader: s.uploader, posterUrls: allAppliedUrls, slots: allAppliedSlots, appliedAt: new Date().toISOString(),
      }).then(() => undefined, (err: unknown) => errorMessage(err))
      onApplied(setKey(s), s.matchedKey, s.title, s.year, allAppliedUrls)
    }
    setApplyMap(m => ({
      ...m,
      [s.id]: { status: totalFailed && !totalDone ? 'error' : 'done', done: totalDone, total: enabledTotal, error: applyError(totalFailed, historyError) },
    }))
  }

  async function applySingle(s: MediuxUserSet, file: PosterInfo) {
    const k = `${s.id}:${file.url}`
    setApplyMap(m => ({ ...m, [k]: { status: 'applying', done: 0, total: 1 } }))
    let target: { key: string; title: string; year?: number; type: 'movie' | 'show' | 'collection' } | null = null
    if (file.isCollection) {
      const coll = await window.api.plex.findCollection(file.title) as { key: string; title: string } | null
      if (coll) target = { key: coll.key, title: coll.title, type: 'collection' }
    } else if (s.matchedKey) {
      target = { key: s.matchedKey, title: s.title, year: s.year, type: s.matchedType ?? 'movie' }
    }
    if (!target) {
      setApplyMap(m => ({ ...m, [k]: { status: 'error', done: 0, total: 1, error: file.isCollection ? 'No matching Plex collection' : 'Not in your library' } }))
      return
    }
    const { done, appliedUrls, appliedSlots, lastError } = await applyPosters(target.key, [file], singleFileTypes(file), () => {})
    if (done) {
      void recordAppliedQuietly({
        itemKey: target.key, title: target.title, year: target.year, type: target.type, source: 'mediux', thumb: file.thumbUrl ?? file.url,
        setId: s.id, uploader: s.uploader, posterUrls: appliedUrls, slots: appliedSlots, appliedAt: new Date().toISOString(),
      })
      if (target.type !== 'collection') onApplied(setKey(s), target.key, s.title, s.year, appliedUrls)
    }
    setApplyMap(m => ({ ...m, [k]: { status: done ? 'done' : 'error', done, total: 1, error: lastError } }))
  }

  return { applyMap, applySet, applySingle }
}
