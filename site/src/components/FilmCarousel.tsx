import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { frames } from '../data/frames'
import { release, isoDay } from '../data/release'
import { Link } from '../lib/router'
import { links } from '../lib/site'
import { useMedia } from '../lib/useMedia'
import { Frame, Perfs } from './Film'

const ADVANCE_MS = 7000
const DRAG_THRESHOLD = 0.14
const COUNT = frames.length
const mod = (i: number) => ((i % COUNT) + COUNT) % COUNT

function Icon({ name }: { name: 'prev' | 'next' | 'play' | 'pause' })
{
  const paths = {
    prev: 'M15 5 8 12l7 7',
    next: 'M9 5l7 7-7 7',
    play: 'M8 5v14l11-7z',
    pause: 'M8 5v14M16 5v14',
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={name === 'pause' ? 3 : 2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  )
}

/**
 * The film strip as a looping carousel of the app's real screens. It moves by
 * the prev and next buttons, the cue-dot pagination, arrow keys, dragging or
 * swiping, or clicking a neighboring frame, and plays on its own until the
 * visitor takes over. Each changeover flashes the cue dot.
 *
 * The track holds three copies of the reel so film always runs past both
 * edges; after a move lands outside the middle copy it snaps back without
 * animation to the same frame in the middle.
 */
export function FilmCarousel()
{
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [pos, setPos] = useState(0)
  const [instant, setInstant] = useState(false)
  const [cue, setCue] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [held, setHeld] = useState(false)
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x: number; moved: boolean } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const active = mod(pos)

  const move = useCallback((to: number) =>
  {
    setInstant(false)
    setPos(Math.max(1 - COUNT, Math.min(2 * COUNT - 2, to)))
    setCue(c => c + 1)
  }, [])

  const take = (to: number) =>
  {
    setPlaying(false)
    move(to)
  }

  const jump = (index: number) => take(pos + (index - active))

  useEffect(() =>
  {
    if (!playing || held || reduced) return
    const timer = window.setInterval(() =>
    {
      if (!document.hidden) move(pos + 1)
    }, ADVANCE_MS)
    return () => window.clearInterval(timer)
  }, [playing, held, reduced, pos, move])

  // Re-center onto the middle copy once a move has landed in an outer one.
  useEffect(() =>
  {
    if (pos >= 0 && pos < COUNT) return
    const settle = window.setTimeout(() =>
    {
      setInstant(true)
      setPos(p => mod(p))
    }, reduced ? 0 : 620)
    return () => window.clearTimeout(settle)
  }, [pos, reduced])

  const onKey = (e: KeyboardEvent) =>
  {
    if (e.key === 'ArrowRight') { e.preventDefault(); take(pos + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); take(pos - 1) }
    else if (e.key === 'Home') { e.preventDefault(); jump(0) }
    else if (e.key === 'End') { e.preventDefault(); jump(COUNT - 1) }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) =>
  {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) =>
  {
    const d = drag.current
    if (!d) return
    const delta = e.clientX - d.x
    if (Math.abs(delta) > 6) d.moved = true
    if (d.moved) setDx(delta)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) =>
  {
    const d = drag.current
    drag.current = null
    setDx(0)
    if (!d) return
    const delta = e.clientX - d.x
    if (d.moved)
    {
      const width = track.current?.querySelector<HTMLElement>('.slot')?.offsetWidth ?? 400
      if (Math.abs(delta) > width * DRAG_THRESHOLD) take(pos + (delta < 0 ? 1 : -1))
      return
    }
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-index]')
    const to = slot ? Number(slot.dataset.index) : pos
    if (to !== pos) take(to)
  }

  const onPointerCancel = () =>
  {
    drag.current = null
    setDx(0)
  }

  const current = frames[active]
  const day = isoDay(release.date)
  const top = (index: number, lit: boolean) =>
  {
    const key = index + 1
    return lit
      ? [String(key), `V${release.version}`, day, `${key}A`].filter(Boolean).join(' ▸ ')
      : `${key} ▸ ${frames[index].label.toUpperCase()} ▸ ${key}A`
  }

  return (
    <section
      className="carousel"
      aria-roledescription="carousel"
      aria-label="The app, screen by screen"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeld(false) }}
    >
      <div className="strip strip-carousel" tabIndex={0} onKeyDown={onKey} aria-label="Screens, use the arrow keys to move">
        <Perfs edge="top" />
        <div
          ref={track}
          className={`strip-track strip-track-carousel${dx ? ' dragging' : ''}${instant || reduced ? ' instant' : ''}`}
          style={{ '--active': pos + COUNT, '--drag': `${dx}px` } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDragStart={e => e.preventDefault()}
        >
          {Array.from({ length: COUNT * 3 }, (_, k) =>
          {
            const at = k - COUNT
            const index = mod(at)
            const f = frames[index]
            const lit = at === pos
            return (
              <div
                key={k}
                className="carousel-slide"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${COUNT}: ${f.label}`}
                aria-hidden={!lit}
              >
                <Frame index={at} src={f.src} alt={f.alt} lit={lit} cue={cue} top={top(index, lit)} bottom={f.edge.toUpperCase()} />
              </div>
            )
          })}
        </div>
        <Perfs edge="bottom" />
      </div>

      <div className="carousel-bar">
        <div className="carousel-caption" aria-live={playing && !held ? 'off' : 'polite'}>
          <p className="carousel-label">{current.label} <span className="carousel-count">{active + 1} / {COUNT}</span></p>
          <p className="carousel-text">{current.caption} <Link href={links.doc(current.doc)}>How it works</Link></p>
        </div>
        <div className="carousel-controls">
          <div className="cue-dots" role="group" aria-label="Choose a screen">
            {frames.map((f, i) => (
              <button key={f.id} type="button" className="cue-dot-button" aria-label={f.label} aria-current={i === active ? 'true' : undefined} onClick={() => jump(i)}>
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" className="carousel-button" onClick={() => take(pos - 1)} aria-label="Previous screen"><Icon name="prev" /></button>
          {!reduced && (
            <button type="button" className="carousel-button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
          )}
          <button type="button" className="carousel-button" onClick={() => take(pos + 1)} aria-label="Next screen"><Icon name="next" /></button>
        </div>
      </div>
    </section>
  )
}
