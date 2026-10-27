import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { frames } from '../data/frames'
import { Link } from '../lib/router'
import { links } from '../lib/site'
import { Icon } from './Icon'
import { Shot } from './Shot'

const VIEWER_SIZES = '(max-width: 760px) 100vw, min(1600px, 92vw)'
const SWIPE_PX = 60

/**
 * The lit frame enlarged: the whole screenshot on the dark of the booth, with
 * the same caption and moves as the strip. Arrow keys, the buttons, and
 * swipes move between screens; Escape, the close button, or a click beside
 * the image closes it. Only the current screen and its neighbors are loaded.
 *
 * @param props.edge - Edge print for the current screen.
 * @param props.onMove - Moves the strip by one frame in either direction.
 */
export function ShotViewer({ open, index, edge, onClose, onMove }: {
  open: boolean
  index: number
  edge: string
  onClose: () => void
  onMove: (step: -1 | 1) => void
})
{
  const dialog = useRef<HTMLDialogElement>(null)
  const swipe = useRef<number | null>(null)
  const count = frames.length
  const current = frames[index]

  useEffect(() =>
  {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])

  const onKeyDown = (e: KeyboardEvent) =>
  {
    if (e.key === 'ArrowRight') { e.preventDefault(); onMove(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onMove(-1) }
  }

  const onPointerDown = (e: PointerEvent) =>
  {
    swipe.current = e.clientX
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) =>
  {
    const start = swipe.current
    swipe.current = null
    if (start === null) return
    const delta = e.clientX - start
    if (Math.abs(delta) > SWIPE_PX) onMove(delta < 0 ? 1 : -1)
    else if (e.target === e.currentTarget) onClose()
  }

  const near = (i: number) => Math.min((i - index + count) % count, (index - i + count) % count) <= 1

  return (
    <dialog ref={dialog} className="viewer" aria-label={`${current.label}, enlarged`} onClose={onClose} onKeyDown={onKeyDown}>
      {open && (
        <>
          <p className="viewer-edge" aria-hidden="true">{edge}</p>
          <button type="button" className="carousel-button viewer-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
          <div className="viewer-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null }}>
            {frames.map((f, i) => near(i) && (
              <Shot key={f.id} className="viewer-shot" picture={f.shot} alt={f.alt} sizes={VIEWER_SIZES} hidden={i !== index} />
            ))}
          </div>
          <div className="carousel-bar viewer-bar">
            <div className="carousel-caption" aria-live="polite">
              <p className="carousel-label">{current.label} <span className="carousel-count">{index + 1} / {count}</span></p>
              <p className="carousel-text">{current.caption} <Link href={links.doc(current.doc)} onClick={onClose}>How it works</Link></p>
            </div>
            <div className="carousel-controls">
              <button type="button" className="carousel-button" onClick={() => onMove(-1)} aria-label="Previous screen"><Icon name="prev" /></button>
              <button type="button" className="carousel-button" onClick={() => onMove(1)} aria-label="Next screen"><Icon name="next" /></button>
            </div>
          </div>
        </>
      )}
    </dialog>
  )
}
