import { useEffect, useRef, useState, useCallback } from 'react'
import type { ArtworkType, PosterInfo } from '../../../../electron/ipc/types'
import { ARTWORK_TYPES } from '../../../../electron/services/schedule/artworkTypes'
import { urlLines, withTxt } from '../bulkText'


export type RunStatus = 'idle' | 'running' | 'done' | 'error'

/** What one URL of a bulk run did. */
export interface RunResult
{
  url: string
  posterCount: number
  uploadedCount: number
  status: 'done' | 'error' | 'no_match'
  error?: string
}


/**
 * The bulk files, the one open in the editor, and running it: each URL is
 * scraped for the picked artwork types and its posters uploaded to Plex.
 *
 * @returns The file list and the open file's text with their actions, the
 *   new-file and rename state, the picked types, and the run's status and results.
 */
export function useBulkFiles()
{
  const [files, setFiles]           = useState<string[]>([])
  const [active, setActive]         = useState<string | null>(null)
  const [content, setContent]       = useState('')
  const [savedContent, setSaved]    = useState('')
  const [renaming, setRenaming]     = useState<string | null>(null)
  const [newFileName, setNewFile]   = useState('')
  const [showNewInput, setShowNew]  = useState(false)
  const [runStatus, setRunStatus]   = useState<RunStatus>('idle')
  const [results, setResults]       = useState<RunResult[]>([])
  const [types, setTypes]           = useState<Set<ArtworkType>>(new Set(ARTWORK_TYPES))
  const abortRef = useRef(false)
  const newInputRef = useRef<HTMLInputElement>(null)

  const isDirty = content !== savedContent


  const loadFiles = useCallback(async () =>
  {
    const list = await window.api.bulk.listFiles() as string[]
    setFiles(list)
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  useEffect(() =>
  {
    window.api.config.get()
      .then(c => { if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters)) })
      .catch(() => { /* keep every type */ })
  }, [])


  async function selectFile(filename: string)
  {
    if (active === filename) return
    setActive(filename)
    setResults([])
    setRunStatus('idle')
    const lines = await window.api.bulk.readFile(filename) as string[]
    const text = lines.join('\n')
    setContent(text)
    setSaved(text)
  }


  async function save()
  {
    if (!active) return
    const lines = urlLines(content)
    await window.api.bulk.writeFile(active, lines)
    setSaved(content)
  }


  useEffect(() =>
  {
    if (showNewInput) setTimeout(() => newInputRef.current?.focus(), 50)
  }, [showNewInput])

  async function createFile()
  {
    const name = newFileName.trim()
    if (!name) return
    const filename = withTxt(name)
    try
    {
      await window.api.bulk.newFile(filename)
      await loadFiles()
      setNewFile('')
      setShowNew(false)
      await selectFile(filename)
    }
    catch (err)
    {
      // file already exists - just select it
      await selectFile(filename)
    }
  }


  async function renameFile(oldName: string, newName: string)
  {
    const newFilename = withTxt(newName)
    await window.api.bulk.renameFile(oldName, newFilename)
    await loadFiles()
    if (active === oldName) setActive(newFilename)
    setRenaming(null)
  }


  async function deleteFile(filename: string)
  {
    await window.api.bulk.deleteFile(filename)
    await loadFiles()
    if (active === filename)
    {
      setActive(null)
      setContent('')
      setSaved('')
    }
  }


  const runFile = useCallback(async () =>
  {
    if (!active || runStatus === 'running') return
    abortRef.current = false
    setRunStatus('running')
    setResults([])

    // Save first if dirty
    if (isDirty) await save()

    const urls = urlLines(content)
    const newResults: RunResult[] = []

    for (const url of urls)
    {
      if (abortRef.current) break
      try
      {
        const posters = await window.api.scrape.url(url, [...types]) as PosterInfo[]
        let uploaded = 0

        for (const poster of posters)
        {
          if (abortRef.current) break
          try
          {
            // Collection art applies to a Plex Collection object (matched by name);
            // everything else to an individual movie/show.
            const targetKey = poster.isCollection
              ? (await window.api.plex.findCollection(poster.title))?.key
              : (await window.api.plex.findItem(poster.title, poster.year, undefined, poster.tmdbId))?.key
            if (!targetKey) continue
            const res = await window.api.plex.uploadPoster(targetKey, poster.url, poster.source, poster.season, poster.episode, poster.isCollection, poster.title) as { success: boolean; error?: string }
            if (res.success) uploaded++
          }
          catch
          {
            // per-poster errors are silent - just skip
          }
        }

        newResults.push({
          url,
          posterCount: posters.length,
          uploadedCount: uploaded,
          status: posters.length === 0 ? 'no_match' : 'done',
        })
      }
      catch (err)
      {
        newResults.push({
          url,
          posterCount: 0,
          uploadedCount: 0,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
      setResults([...newResults])
    }

    setRunStatus('done')
  }, [active, content, isDirty, runStatus, types])

  return {
    files, active, content, setContent, isDirty,
    renaming, setRenaming, newFileName, setNewFile, showNewInput, setShowNew, newInputRef,
    runStatus, results, types, setTypes,
    selectFile, save, createFile, renameFile, deleteFile, runFile,
  }
}

/** The bulk page's state and actions, as `useBulkFiles` returns them. */
export type BulkFiles = ReturnType<typeof useBulkFiles>
