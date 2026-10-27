import type { CSSProperties } from 'react'

/** A row of sprocket holes at 35mm pitch, sized from the strip's frame height. */
export function Perfs({ edge }: { edge: 'top' | 'bottom' })
{
  return <div className={`perfs perfs-${edge}`} aria-hidden="true" />
}

/**
 * One frame on the strip with the latent print on its edges, so key numbers
 * and the screen's own facts travel with the frame through a changeover.
 *
 * @param props.src - The screen shown in the frame.
 * @param props.alt - What the screen shows; empty for a frame that only sets context.
 * @param props.lit - Whether the lamp is on this frame.
 * @param props.top - Edge print above the frame: its key number and name.
 * @param props.bottom - Edge print below the frame: what the screen shows.
 * @param props.cue - Changes whenever the cue dot should flash again.
 * @param props.focus - Crop for a screen whose content sits in one part of the capture.
 */
export function Frame({ src, alt, lit, top, bottom, cue, focus }: {
  src: string
  alt: string
  lit?: boolean
  top?: string
  bottom?: string
  cue?: number
  focus?: { origin: string; scale: number }
})
{
  const crop: CSSProperties | undefined = focus ? { transformOrigin: focus.origin, transform: `scale(${focus.scale})` } : undefined
  return (
    <div className={`slot${lit ? ' slot-lit' : ''}`}>
      {top && <span className="slot-edge slot-edge-top" aria-hidden="true">{top}</span>}
      <figure className={`frame${lit ? ' frame-lit' : ''}`}>
        <img src={src} alt={alt} loading={lit ? 'eager' : 'lazy'} decoding="async" style={crop} />
        {lit && <span key={cue} className="cue-dot" aria-hidden="true" />}
      </figure>
      {bottom && <span className="slot-edge slot-edge-bottom" aria-hidden="true">{bottom}</span>}
    </div>
  )
}
