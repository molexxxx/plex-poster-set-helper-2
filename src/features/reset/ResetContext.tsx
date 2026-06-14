import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type ResetItemStatus = 'resetting' | 'done' | 'error'

interface ResetValue {
  /** True while a Reset All batch is in progress. */
  running: boolean
  /** Total items in the active batch. */
  total: number
  /** Items processed so far in the active batch. */
  completed: number
  /** Per-item status overlay, keyed by Plex itemKey (absent = idle). */
  statuses: Record<string, ResetItemStatus>
  /** Bumped whenever an item is forgotten from config, so the list can refresh. */
  revision: number
  /** Resets every given item sequentially. Lives at the app root so it survives
   *  navigating away from the Reset page mid-run. */
  startAll: (keys: string[], deleteUploads: boolean) => void
  /** Resets a single item. */
  resetOne: (key: string, deleteUploads: boolean) => void
}

/** How long a finished item shows its green "Reset" flash before the row drops. */
const FLASH_MS = 480

const ResetContext = createContext<ResetValue>({
  running: false, total: 0, completed: 0, statuses: {}, revision: 0,
  startAll: () => {}, resetOne: () => {},
})

/** Accesses the shared reset run-state and actions. */
export const useReset = () => useContext(ResetContext)

/**
 * Owns the Reset Posters work loop. Kept above the routed pages so a Reset All
 * keeps running (and its progress stays visible) when the user navigates away
 * from the Reset page and back. The page is a thin view over this state.
 */
export function ResetProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning]     = useState(false)
  const [total, setTotal]         = useState(0)
  const [completed, setCompleted] = useState(0)
  const [statuses, setStatuses]   = useState<Record<string, ResetItemStatus>>({})
  const [revision, setRevision]   = useState(0)

  const runningRef = useRef(false)
  // Serialise config writes: a read-modify-write per item would otherwise clobber
  // a sibling forget when two resets resolve close together.
  const writeChain = useRef<Promise<void>>(Promise.resolve())

  const setStatus = useCallback((key: string, status: ResetItemStatus) => {
    setStatuses(prev => ({ ...prev, [key]: status }))
  }, [])

  const clearStatus = useCallback((key: string) => {
    setStatuses(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  /** Drops an item from the applied-poster history, then signals a list refresh. */
  const forget = useCallback((key: string) => {
    writeChain.current = writeChain.current.then(async () => {
      const cfg = await window.api.config.get()
      const next = (cfg.appliedPosters ?? []).filter(r => r.itemKey !== key)
      await window.api.config.set({ appliedPosters: next })
      setRevision(v => v + 1)
    })
    return writeChain.current
  }, [])

  /**
   * Resets one item: mark it resetting, restore the Plex original, flash the
   * "done" state, then forget it from history. Forgetting after the flash keeps
   * the row (and its green confirmation) on screen through the animation.
   */
  const runOne = useCallback(async (key: string, deleteUploads: boolean) => {
    setStatus(key, 'resetting')
    try {
      await window.api.plex.resetPoster(key, true, deleteUploads)
      setStatus(key, 'done')
      await new Promise(r => setTimeout(r, FLASH_MS))
      await forget(key)
      clearStatus(key)
    } catch {
      setStatus(key, 'error')
    }
  }, [setStatus, clearStatus, forget])

  const resetOne = useCallback((key: string, deleteUploads: boolean) => {
    void runOne(key, deleteUploads)
  }, [runOne])

  const startAll = useCallback((keys: string[], deleteUploads: boolean) => {
    if (runningRef.current || keys.length === 0) return
    runningRef.current = true
    setRunning(true)
    setTotal(keys.length)
    setCompleted(0)
    void (async () => {
      for (const key of keys) {
        await runOne(key, deleteUploads)
        setCompleted(c => c + 1)
      }
      setRunning(false)
      runningRef.current = false
    })()
  }, [runOne])

  return (
    <ResetContext.Provider value={{ running, total, completed, statuses, revision, startAll, resetOne }}>
      {children}
    </ResetContext.Provider>
  )
}
