import { useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FilePlus2, Trash2, Play, Save, FileText, Pencil, Check, X,
  AlertCircle, CheckCircle2,
} from 'lucide-react'
import Button from '../../components/ui/Button'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import PlexConnectBanner from '../../components/ui/PlexConnectBanner'
import { useAppContext } from '../../app/AppContext'
import type { PosterInfo } from '../../../electron/ipc/types'
import styles from './BulkPage.module.css'

// --- Types --------------------------------------------------------------------

type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface RunResult {
  url: string
  posterCount: number
  uploadedCount: number
  status: 'done' | 'error' | 'no_match'
  error?: string
}

// --- Helpers ------------------------------------------------------------------

function displayName(filename: string) {
  return filename.replace(/\.txt$/, '')
}

// --- Inline rename input ------------------------------------------------------

function RenameInput({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string
  onConfirm: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(displayName(initial))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.select() }, [])

  function submit() {
    const v = value.trim()
    if (v && v !== displayName(initial)) onConfirm(v)
    else onCancel()
  }

  return (
    <div className={styles.renameRow}>
      <input
        ref={ref}
        className={styles.renameInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
        spellCheck={false}
        autoFocus
      />
      <button className={styles.iconBtn} onClick={submit}><Check size={12} /></button>
      <button className={styles.iconBtn} onClick={onCancel}><X size={12} /></button>
    </div>
  )
}

// --- Main component -----------------------------------------------------------

export default function BulkPage() {
  const { plexConnected } = useAppContext()
  const [files, setFiles]           = useState<string[]>([])
  const [active, setActive]         = useState<string | null>(null)
  const [content, setContent]       = useState('')
  const [savedContent, setSaved]    = useState('')
  const [renaming, setRenaming]     = useState<string | null>(null)
  const [newFileName, setNewFile]   = useState('')
  const [showNewInput, setShowNew]  = useState(false)
  const [runStatus, setRunStatus]   = useState<RunStatus>('idle')
  const [results, setResults]       = useState<RunResult[]>([])
  const abortRef = useRef(false)
  const newInputRef = useRef<HTMLInputElement>(null)

  const isDirty = content !== savedContent

  // -- Load file list ---------------------------------------------------------

  const loadFiles = useCallback(async () => {
    const list = await window.api.bulk.listFiles() as string[]
    setFiles(list)
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  // -- Select file ------------------------------------------------------------

  async function selectFile(filename: string) {
    if (active === filename) return
    setActive(filename)
    setResults([])
    setRunStatus('idle')
    const lines = await window.api.bulk.readFile(filename) as string[]
    const text = lines.join('\n')
    setContent(text)
    setSaved(text)
  }

  // -- Save -------------------------------------------------------------------

  async function save() {
    if (!active) return
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
    await window.api.bulk.writeFile(active, lines)
    setSaved(content)
  }

  // -- New file ---------------------------------------------------------------

  useEffect(() => {
    if (showNewInput) setTimeout(() => newInputRef.current?.focus(), 50)
  }, [showNewInput])

  async function createFile() {
    const name = newFileName.trim()
    if (!name) return
    const filename = name.endsWith('.txt') ? name : `${name}.txt`
    try {
      await window.api.bulk.newFile(filename)
      await loadFiles()
      setNewFile('')
      setShowNew(false)
      await selectFile(filename)
    } catch (err) {
      // file already exists - just select it
      await selectFile(filename)
    }
  }

  // -- Rename -----------------------------------------------------------------

  async function renameFile(oldName: string, newName: string) {
    const newFilename = newName.endsWith('.txt') ? newName : `${newName}.txt`
    await window.api.bulk.renameFile(oldName, newFilename)
    await loadFiles()
    if (active === oldName) setActive(newFilename)
    setRenaming(null)
  }

  // -- Delete -----------------------------------------------------------------

  async function deleteFile(filename: string) {
    await window.api.bulk.deleteFile(filename)
    await loadFiles()
    if (active === filename) {
      setActive(null)
      setContent('')
      setSaved('')
    }
  }

  // -- Run --------------------------------------------------------------------

  const runFile = useCallback(async () => {
    if (!active || runStatus === 'running') return
    abortRef.current = false
    setRunStatus('running')
    setResults([])

    // Save first if dirty
    if (isDirty) await save()

    const urls = content.split('\n').map(l => l.trim()).filter(Boolean)
    const newResults: RunResult[] = []

    for (const url of urls) {
      if (abortRef.current) break
      try {
        const posters = await window.api.scrape.url(url) as PosterInfo[]
        let uploaded = 0

        for (const poster of posters) {
          if (abortRef.current) break
          try {
            // Collection art applies to a Plex Collection object (matched by name);
            // everything else to an individual movie/show.
            const targetKey = poster.isCollection
              ? (await window.api.plex.findCollection(poster.title))?.key
              : (await window.api.plex.findItem(poster.title, poster.year))?.key
            if (!targetKey) continue
            const res = await window.api.plex.uploadPoster(targetKey, poster.url, poster.source, poster.season, poster.episode) as { success: boolean; error?: string }
            if (res.success) uploaded++
          } catch {
            // per-poster errors are silent - just skip
          }
        }

        newResults.push({
          url,
          posterCount: posters.length,
          uploadedCount: uploaded,
          status: posters.length === 0 ? 'no_match' : 'done',
        })
      } catch (err) {
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
  }, [active, content, isDirty, runStatus])

  // --- Render ----------------------------------------------------------------

  const totalUploaded = results.reduce((n, r) => n + r.uploadedCount, 0)
  const errorCount    = results.filter(r => r.status === 'error').length
  const urlCount      = content.split('\n').map(l => l.trim()).filter(Boolean).length

  return (
    <div className={styles.page}>

      {/* -- Left: file list -------------------------------------------------- */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className="page-title">Bulk Import</span>
          <button
            className={styles.iconBtn}
            title="New file"
            onClick={() => setShowNew(v => !v)}
          >
            <FilePlus2 size={14} />
          </button>
        </div>

        {/* new file input */}
        <AnimatePresence>
          {showNewInput && (
            <motion.div
              className={styles.newFileRow}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
            >
              <input
                ref={newInputRef}
                className={styles.renameInput}
                value={newFileName}
                onChange={e => setNewFile(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFile()
                  if (e.key === 'Escape') { setShowNew(false); setNewFile('') }
                }}
                placeholder="file name"
                spellCheck={false}
              />
              <button className={styles.iconBtn} onClick={createFile}><Check size={12} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* file list */}
        <div className={styles.fileList}>
          {files.length === 0 && !showNewInput && (
            <p className={styles.noFiles}>No files yet</p>
          )}
          <AnimatePresence initial={false}>
            {files.map(f => (
              <motion.div
                key={f}
                className={`${styles.fileItem} ${active === f ? styles.fileActive : ''}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
              >
                {renaming === f ? (
                  <RenameInput
                    initial={f}
                    onConfirm={newName => renameFile(f, newName)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <>
                    <button
                      className={styles.fileBtn}
                      onClick={() => selectFile(f)}
                    >
                      <FileText size={13} className={styles.fileIcon} />
                      <span className={styles.fileName}>{displayName(f)}</span>
                    </button>
                    <div className={styles.fileActions}>
                      <button
                        className={styles.iconBtn}
                        title="Rename"
                        onClick={e => { e.stopPropagation(); setRenaming(f) }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDestructive}`}
                        title="Delete"
                        onClick={e => { e.stopPropagation(); deleteFile(f) }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </aside>

      {/* -- Right: editor ---------------------------------------------------- */}
      <div className={styles.editor}>
        {!plexConnected && <PlexConnectBanner />}
        {!active ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No file selected"
            description="Create or select a bulk file to edit its URL list."
          />
        ) : (
          <>
            {/* editor header */}
            <div className={styles.editorHeader}>
              <div>
                <span className={styles.editorTitle}>{displayName(active)}</span>
                {isDirty && <span className={styles.dirtyDot} title="Unsaved changes" />}
              </div>
              <div className={styles.editorHeaderRight}>
                {urlCount > 0 && (
                  <span className={styles.urlCount}>{urlCount} URL{urlCount !== 1 ? 's' : ''}</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Save size={13} />}
                  onClick={save}
                  disabled={!isDirty}
                >
                  Save
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={runStatus === 'running' ? <Spinner size="xs" color="current" /> : <Play size={13} />}
                  onClick={runFile}
                  disabled={runStatus === 'running' || urlCount === 0}
                >
                  {runStatus === 'running' ? 'Running…' : 'Run'}
                </Button>
              </div>
            </div>

            {/* textarea */}
            <textarea
              className={styles.urlEditor}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={'https://theposterdb.com/set/12345\nhttps://mediux.pro/sets/67890\n…'}
              spellCheck={false}
              disabled={runStatus === 'running'}
            />

            {/* run results */}
            <AnimatePresence>
              {results.length > 0 && (
                <motion.div
                  className={styles.results}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className={styles.resultsSummary}>
                    {runStatus === 'running' && <Spinner size="xs" />}
                    <span>
                      {results.length}/{urlCount} processed
                      {totalUploaded > 0 && ` · ${totalUploaded} uploaded`}
                      {errorCount > 0 && (
                        <span className={styles.errorCount}> · {errorCount} error{errorCount !== 1 ? 's' : ''}</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.resultList}>
                    {results.map((r, i) => (
                      <div key={i} className={`${styles.resultRow} ${r.status === 'error' ? styles.resultError : ''}`}>
                        <span className={styles.resultIcon}>
                          {r.status === 'error' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
                        </span>
                        <span className={styles.resultUrl}>{r.url.replace(/https?:\/\//, '')}</span>
                        <span className={styles.resultMeta}>
                          {r.status === 'error'
                            ? r.error?.slice(0, 50)
                            : r.status === 'no_match'
                            ? 'no posters found'
                            : `${r.uploadedCount}/${r.posterCount} uploaded`}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}
