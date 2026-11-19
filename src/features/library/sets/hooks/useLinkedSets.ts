import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryItem, LinkedItemRef, PosterSetSummary } from '../../../../../electron/ipc/types'
import { mergeLinkedSets } from '../../../../utils/librarySets'
import { errorMessage } from '../../../../utils/errorMessage'
/** Sets read from the links attached to one item, with the links that could not be read. */
interface LinkedState { key: string; sets: PosterSetSummary[]; errors: Array<{ url: string; error: string }> }
/** The link row for one item: whether it is open, the typed link, and why the last one was refused. */
interface LinkUiState { key: string; open: boolean; url: string; error: string | null }
const NO_SETS: PosterSetSummary[] = []
const NO_LINK_ERRORS: Array<{ url: string; error: string }> = []

/**
 * The set links the user attached to an item: the sets read from them, the
 * links that could not be read, and the link-a-set row's state.
 *
 * @param item - The title or collection the panel shows.
 * @param setsReloadKey - Bumped by Refresh, which reads the linked pages again too.
 * @returns The linked sets and errors, the link row's state and input ref, and `submitLink` and `unlink`.
 */
export function useLinkedSets(item: LibraryItem, setsReloadKey: number)
{
  // Sets read from the links the user attached to this title, scoped the same way.
  const [linkedState, setLinkedState] = useState<LinkedState>({ key: '', sets: [], errors: [] })
  const linked = linkedState.key === item.key ? linkedState.sets : NO_SETS
  const linkErrors = linkedState.key === item.key ? linkedState.errors : NO_LINK_ERRORS
  const [linkUi, setLinkUi] = useState<LinkUiState>({ key: '', open: false, url: '', error: null })
  const linkOpen = linkUi.key === item.key && linkUi.open
  const linkUrl = linkUi.key === item.key ? linkUi.url : ''
  const linkError = linkUi.key === item.key ? linkUi.error : null
  const [linking, setLinking] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const updateLinkUi = (patch: Partial<Omit<LinkUiState, 'key'>>) =>
    setLinkUi(prev => ({ ...(prev.key === item.key ? prev : { open: false, url: '', error: null }), ...patch, key: item.key }))

  useEffect(() =>
  {
    if (linkOpen) linkInputRef.current?.focus()
  }, [linkOpen])

  // The item as the links are attached to it.
  const linkedItem = useMemo<LinkedItemRef>(
    () => ({ key: item.key, type: item.type, title: item.title, year: item.year }),
    [item.key, item.type, item.title, item.year],
  )

  // Linked sets load beside the browse; Refresh re-reads their pages too. The
  // previous item's sets never show here, since the state is keyed by item.
  useEffect(() =>
  {
    let cancelled = false
    const key = item.key
    window.api.library.linkedSets({ item: linkedItem, fresh: setsReloadKey > 0 }).then(res =>
    {
      if (!cancelled) setLinkedState({ key, sets: res.sets, errors: res.errors ?? [] })
    }).catch((err: unknown) =>
    {
      if (!cancelled) setLinkedState({ key, sets: [], errors: [{ url: '', error: errorMessage(err) }] })
    })
    return () => { cancelled = true }
  }, [item.key, linkedItem, setsReloadKey])

  async function submitLink()
  {
    const url = linkUrl.trim()
    if (!url || linking) return
    setLinking(true)
    updateLinkUi({ error: null })
    try
    {
      const res = await window.api.library.linkSet({ item: linkedItem, url })
      const refused = res.errors?.[0]
      if (refused)
      {
        updateLinkUi({ error: refused.error })
        return
      }
      const key = item.key
      setLinkedState(prev => prev.key === key
        ? { ...prev, sets: mergeLinkedSets(prev.sets, res.sets) }
        : { key, sets: res.sets, errors: [] })
      updateLinkUi({ open: false, url: '' })
    }
    catch (err)
    {
      updateLinkUi({ error: errorMessage(err) })
    }
    finally
    {
      setLinking(false)
    }
  }

  async function unlink(url: string)
  {
    const key = item.key
    setLinkedState(prev => prev.key === key
      ? { ...prev, sets: prev.sets.filter(s => s.linkedFrom !== url), errors: prev.errors.filter(e => e.url !== url) }
      : prev)
    try
    {
      await window.api.library.unlinkSet({ itemKey: key, url })
    }
    catch (err)
    {
      updateLinkUi({ open: true, error: errorMessage(err) })
    }
  }

  return { linked, linkErrors, linkOpen, linkUrl, linkError, linking, linkInputRef, updateLinkUi, submitLink, unlink }
}

/** The linked-set state and actions `useLinkedSets` returns. */
export type LinkedSets = ReturnType<typeof useLinkedSets>
