import type { CSSProperties } from 'react'

/** A row of sprocket holes at 35mm pitch, sized from the strip's frame height. */
export function Perfs({ edge }: { edge: 'top' | 'bottom' })
{
  return <div className={`perfs perfs-${edge}`} aria-hidden="true" />
}

/**
 * One frame on the strip with the latent print on its edges, so key numbers
 * and the screen's own facts travel with the frame. The screen is painted as a
 * background, so it can't be dragged out or saved by accident.
 *
 * @param props.src - The screen shown in the frame.
 * @param props.alt - What the screen shows.
 * @param props.lit - Whether the lamp is on this frame.
 * @param props.top - Edge print above the frame: its key number and name.
 * @param props.bottom - Edge print below the frame: what the screen shows.
 * @param props.cue - Changes whenever the cue dot should flash again.
 */
export function Frame({ src, alt, lit, top, bottom, cue, index }: {
  src: string
  alt: string
  lit?: boolean
  top?: string
  bottom?: string
  cue?: number
  index?: number
})
{
  const shot: CSSProperties = { backgroundImage: `url("${src}")` }
  return (
    <div className={`slot${lit ? ' slot-lit' : ''}`} data-index={index}>
      {top && <span className="slot-edge slot-edge-top" aria-hidden="true">{top}</span>}
      <div className={`frame${lit ? ' frame-lit' : ''}`}>
        <div className="frame-shot" style={shot} role="img" aria-label={alt} />
        {lit && <span key={cue} className="cue-dot" aria-hidden="true" />}
      </div>
      {bottom && <span className="slot-edge slot-edge-bottom" aria-hidden="true">{bottom}</span>}
    </div>
  )
}
