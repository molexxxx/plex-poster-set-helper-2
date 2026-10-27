import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Frame as FrameData } from '../data/frames'
import { links } from '../lib/site'
import { useMedia } from '../lib/useMedia'
import { Frame, Perfs } from './Film'

const keyNumber = (i: number) => `${i + 1} ▸ `
const top = (f: FrameData, i: number) => `${keyNumber(i)}${f.label.toUpperCase()} ▸ ${i + 1}A`

/**
 * The reel: one frame per capability. On wide screens the page's scroll runs
 * the strip a frame at a time with a cue flash at each changeover; phones swipe
 * it, and reduced motion lays it out as a still contact strip.
 *
 * @param props.frames - The frames, in reel order.
 */
export function Reel({ frames }: { frames: FrameData[] })
{
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const narrow = useMedia('(max-width: 760px)')
  const scrub = !reduced && !narrow

  const section = useRef<HTMLDivElement>(null)
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)
  const [cue, setCue] = useState(0)

  useEffect(() =>
  {
    if (!scrub) return
    let frame = 0
    const read = () =>
    {
      frame = 0
      const el = section.current
      if (!el) return
      const travel = el.offsetHeight - window.innerHeight
      const progress = Math.min(1, Math.max(0, -el.getBoundingClientRect().top / Math.max(1, travel)))
      const next = Math.min(frames.length - 1, Math.floor(progress * frames.length))
      if (next !== activeRef.current)
      {
        activeRef.current = next
        setActive(next)
        setCue(c => c + 1)
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () =>
    {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrub, frames.length])

  const heading = (
    <div className="reel-heading">
      <h2 id="reel-title">Pick a title, apply a set, and let the schedule keep it current.</h2>
    </div>
  )

  if (!scrub)
  {
    return (
      <section className={`reel reel-still${narrow ? ' reel-swipe' : ''}`} aria-labelledby="reel-title">
        {heading}
        <StillStrip frames={frames} swipe={narrow} />
      </section>
    )
  }

  const current = frames[active]
  return (
    <section className="reel reel-scrub" aria-labelledby="reel-title">
      {heading}
      <div ref={section} className="reel-run" style={{ '--count': frames.length } as CSSProperties}>
        <div className="reel-pin">
          <div className="strip strip-reel">
            <Perfs edge="top" />
            <div className="strip-track strip-track-reel" style={{ '--active': active } as CSSProperties}>
              {frames.map((f, i) => (
                <Frame key={f.id} src={f.full} alt={f.alt} lit={i === active} cue={cue} top={top(f, i)} bottom={f.edge.toUpperCase()} focus={f.focus} />
              ))}
            </div>
            <Perfs edge="bottom" />
          </div>
          <div className="reel-caption" aria-live="polite">
            <h3>{current.label}<span className="sr-only">, frame {active + 1} of {frames.length}</span></h3>
            <p>{current.caption}</p>
            <a href={links.doc(current.doc)}>How it works</a>
          </div>
        </div>
      </div>
    </section>
  )
}

/** The reel without scroll control: a contact strip, swiped one frame at a time on phones. */
function StillStrip({ frames, swipe }: { frames: FrameData[]; swipe: boolean })
{
  const track = useRef<HTMLOListElement>(null)
  const [centered, setCentered] = useState(0)

  useEffect(() =>
  {
    const list = track.current
    if (!swipe || !list) return
    const watch = new IntersectionObserver(entries =>
    {
      for (const e of entries)
      {
        if (e.isIntersecting) setCentered(Number((e.target as HTMLElement).dataset.index))
      }
    }, { root: list, threshold: 0.6 })
    for (const li of Array.from(list.children)) watch.observe(li)
    return () => watch.disconnect()
  }, [swipe])

  return (
    <div className="strip strip-still">
      <Perfs edge="top" />
      <ol ref={track} className="strip-track">
        {frames.map((f, i) => (
          <li key={f.id} data-index={i} data-centered={!swipe || centered === i ? 'true' : undefined}>
            <Frame src={f.full} alt={f.alt} focus={f.focus} />
            <p className="still-label">{f.label}</p>
            <p className="still-caption">{f.caption} <a href={links.doc(f.doc)}>How it works</a></p>
            <span className="sr-only">Frame {i + 1} of {frames.length}</span>
          </li>
        ))}
      </ol>
      <Perfs edge="bottom" />
    </div>
  )
}
