import { useCallback, useEffect, useState } from 'react'
import type { AnimeListStatus } from '../../../../electron/ipc/types'

/**
 * The downloaded anime ID list. Reads its status while the Artwork group is
 * open, polls while a download runs, and downloads a new copy on request.
 *
 * @param active - Whether the Artwork group is showing.
 * @param announce - Reads a result out to screen readers.
 * @returns The list status, whether an update is running or just finished, and `updateAnimeList`.
 */
export function useAnimeList(active: boolean, announce: (message: string) => void)
{
  const [animeList, setAnimeList]         = useState<AnimeListStatus | null>(null)
  const [animeUpdating, setAnimeUpdating] = useState(false)
  const [animeUpdated, setAnimeUpdated]   = useState(false)

  const loadAnimeList = useCallback(async () =>
  {
    try
    {
      setAnimeList(await window.api.app.animeListStatus())
    }
    catch
    {
      setAnimeList(null)
    }
  }, [])

  useEffect(() =>
  {
    if (!active) return
    let live = true
    window.api.app.animeListStatus()
      .then(status => { if (live) setAnimeList(status) })
      .catch(() => { if (live) setAnimeList(null) })
    return () => { live = false }
  }, [active])

  useEffect(() =>
  {
    if (!animeList?.updating || animeUpdating) return
    const timer = setTimeout(() => void loadAnimeList(), 2000)
    return () => clearTimeout(timer)
  }, [animeList, animeUpdating, loadAnimeList])

  async function updateAnimeList()
  {
    setAnimeUpdating(true)
    try
    {
      const next = await window.api.app.updateAnimeList()
      setAnimeList(next)
      if (next.error)
      {
        announce(`The anime list could not be downloaded: ${next.error}`)
      }
      else
      {
        setAnimeUpdated(true)
        announce('Anime list updated')
        setTimeout(() => setAnimeUpdated(false), 2500)
      }
    }
    catch (err)
    {
      const error = err instanceof Error ? err.message : String(err)
      setAnimeList(prev => ({ downloaded: false, ...prev, updating: false, error }))
      announce(`The anime list could not be downloaded: ${error}`)
    }
    finally
    {
      setAnimeUpdating(false)
    }
  }

  return { animeList, animeUpdating, animeUpdated, updateAnimeList }
}

/** The anime list state and update action `useAnimeList` returns. */
export type AnimeList = ReturnType<typeof useAnimeList>
