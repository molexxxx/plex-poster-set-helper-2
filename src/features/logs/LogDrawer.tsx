import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import LogViewer from './LogViewer'
import styles from './LogDrawer.module.css'

const MIN_H = 140
const DEFAULT_H = 320
const STEP = 32
const HEIGHT_KEY = 'logs.drawerHeight'

interface Props
{
  open: boolean
  onClose: () => void
  /** Opens the full Logs page. */
  onExpand: () => void
}

function maxHeight(): number
{
  return Math.max(MIN_H, Math.round(window.innerHeight * 0.6))
}

function savedHeight(): number
{
  try
  {
    const n = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(n) && n >= MIN_H ? n : DEFAULT_H
  }
  catch
  {
    return DEFAULT_H
  }
}

function saveHeight(h: number): void
{
  try
  {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(h)))
  }
  catch
  {
    /* storage may be unavailable */
  }
}

/**
 * The log panel docked under the pages. Its height is saved per browser,
 * capped at 60% of the window, and adjustable by dragging or with the arrow
 * keys on its handle. Escape closes it and focus returns to where it was.
 */
export default function LogDrawer({ open, onClose, onExpand }: Props)
{
  const reducedMotion = useReducedMotion()
  const [height, setHeight] = useState(savedHeight)
  const [limit, setLimit] = useState(maxHeight)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const shown = Math.min(height, limit)

  useEffect(() =>
  {
    const onResize = () => setLimit(maxHeight())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() =>
  {
    if (!open) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [open])

  function close()
  {
    onClose()
    const target = returnFocus.current
    returnFocus.current = null
    if (target?.isConnected) target.focus()
  }

  function commit(next: number)
  {
    const h = Math.max(MIN_H, Math.min(maxHeight(), next))
    setHeight(h)
    saveHeight(h)
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>)
  {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = shown
    let last = startH
    setDragging(true)

    function onMove(ev: PointerEvent)
    {
      last = Math.max(MIN_H, Math.min(maxHeight(), startH + (startY - ev.clientY)))
      setHeight(last)
    }

    function onUp()
    {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setDragging(false)
      saveHeight(last)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function onHandleKey(e: React.KeyboardEvent<HTMLDivElement>)
  {
    const next = e.key === 'ArrowUp' ? shown + STEP
      : e.key === 'ArrowDown' ? shown - STEP
      : e.key === 'Home' ? limit
      : e.key === 'End' ? MIN_H
      : null
    if (next == null) return
    e.preventDefault()
    commit(next)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          className={styles.drawer}
          tabIndex={-1}
          onKeyDown={e =>
          {
            if (e.key === 'Escape' && e.target === e.currentTarget)
            {
              e.preventDefault()
              close()
            }
          }}
          initial={{ height: 0 }}
          animate={{ height: shown }}
          exit={{ height: 0 }}
          transition={reducedMotion || dragging ? { duration: 0 } : { ease: [0.16, 1, 0.3, 1], duration: 0.22 }}
        >
          <div
            className={styles.handle}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize logs"
            aria-valuemin={MIN_H}
            aria-valuemax={limit}
            aria-valuenow={Math.round(shown)}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onHandleKey}
            onDoubleClick={() => commit(DEFAULT_H)}
            title="Drag to resize. Double-click to reset."
          >
            <span className={styles.grip} />
          </div>
          <div className={styles.content}>
            <LogViewer mode="drawer" onClose={close} onExpand={onExpand} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
